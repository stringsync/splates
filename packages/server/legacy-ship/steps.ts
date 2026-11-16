import type { StepProject } from "./step-project";

export type { StepProject } from "./step-project";

import { ensure } from "core/assert";
import type { AsyncResource } from "core/disposable";
import type { Fs } from "core/system";
import { Duration, SystemWallClock, type WallClock } from "core/time";
import { fail } from "../exit";
import type { Storage } from "../storage";
import { ShipQuestions } from "./answer";
import { type Cascade, type CascadeStep, Cascades } from "./cascade";
import type { ShipGraph } from "./graph";
import type { ShipLive } from "./live";
import type { Ship } from "./run";
import {
	SHIP_SELECTION,
	type ShipSelection,
	ShipSelections,
} from "./selection";
import { begun, ended, type StageKey } from "./stages";
import type { StepContext, StepRecord } from "./step-context";
import { waitLive } from "./step-live";
import { publishStep } from "./step-publish";

export interface ShipStepsOptions {
	graph(inputs?: ReturnType<typeof ShipSelections.inputs>): Promise<ShipGraph>;
	project(slug: string): Promise<StepProject>;
	live: Pick<ShipLive, "check">;
	clock?: WallClock;
	pause?: () => Promise<void>;
	/** Reports a background storage or runner failure. */
	error(error: unknown): void;
}

const STEP_KEYS: StageKey[] = ["upstream", "adopt", "publish", "live"];

/** Ship selected projects in release order, with Retry and Abandon for a stopped release. */
export class ShipSteps extends Cascades implements AsyncResource {
	private readonly record;
	private readonly clock: WallClock;
	private going: Promise<void> | null = null;
	private closing = false;
	private controller = new AbortController();
	readonly questions: ShipQuestions;
	private publisher: StepProject["shipping"] | null = null;
	constructor(
		private readonly storage: Storage,
		private readonly fs: Fs,
		private readonly opts: ShipStepsOptions,
	) {
		super(storage, fs);
		this.questions = new ShipQuestions(this, opts);
		this.record = storage.document<StepRecord>("ship-steps.json");
		this.clock = opts.clock ?? new SystemWallClock();
	}

	override async current(): Promise<Cascade | null> {
		return (await this.record.read())?.cascade ?? null;
	}

	override async shown(): Promise<{
		cascade: Cascade | null;
		ship: Ship | null;
	}> {
		const cascade = await this.current();
		const step = cascade?.steps.find((each) => each.status === "shipping");
		const ship =
			step === undefined
				? null
				: await (await this.opts.project(step.slug)).shipping.current();
		return { cascade, ship };
	}

	/** Start only after validating every choice; a stopped ship still owns the machine. */
	async start(input: ShipSelection): Promise<Cascade> {
		const selection = SHIP_SELECTION.parse(input);

		const lock = this.storage.lock("ship-start.lock");
		await lock.acquire();
		try {
			const current = await this.current();
			if (
				current?.status === "running" ||
				current?.status === "stopped" ||
				this.going !== null
			) {
				fail("conflict", "a ship is under way; Retry or Abandon it first");
			}
			const record = await new ShipSelections(this.history).create(
				await this.opts.graph(ShipSelections.inputs(selection)),
				selection,
				this.stamp(),
			);
			const { cascade } = record;
			await this.record.write(record);
			await this.history.file(cascade);
			await this.history.prune();
			this.run();
			return cascade;
		} finally {
			await lock.release();
		}
	}

	/** A failed stage is retried in place; completed stages stay complete. */
	async retry(): Promise<Cascade> {
		const lock = this.storage.lock("ship-start.lock");
		await lock.acquire();
		try {
			const record = await this.record.read();
			if (record?.cascade.status !== "stopped" || this.going !== null) {
				fail("conflict", "no stopped ship is ready to retry");
			}
			for (const step of record.cascade.steps) {
				if (step.planned && step.status === "failed") {
					for (const stage of step.stages) {
						if (stage.key === "publish" || stage.key === "live") {
							stage.state = "pending";
							stage.started = null;
							stage.ended = null;
							stage.check = null;
							stage.releaseSteps = stage.releaseSteps?.map((release) => ({
								...release,
								state: "pending",
								started: null,
								ended: null,
								error: null,
								log: undefined,
								checked: null,
								status: null,
								staged: [],
							}));
							stage.deadline = null;
						}
					}
				}
			}
			record.cascade.status = "running";
			record.cascade.ended = null;
			await this.save(record);
			this.run();
			return record.cascade;
		} finally {
			await lock.release();
		}
	}

	/** Remember a page handoff without changing adoption or restarting the ship. */
	async recordAgent(id: string, slug: string): Promise<Cascade> {
		const saved = await this.record.update((record) => {
			const step = record?.cascade.steps.find((each) => each.slug === slug);
			if (record === null || record.cascade.id !== id || step === undefined) {
				fail("not_found", "no matching ship project", { id, slug });
			}
			step.sentToAgent = true;
			return record;
		});
		await this.history.file(saved.cascade);
		return saved.cascade;
	}

	/** Records that the person has seen cascade `id`'s result; a no-op once it is not the current one. */
	async see(id: string): Promise<Cascade | null> {
		if ((await this.current())?.id !== id) {
			return null;
		}
		const saved = await this.record.update((record) => {
			if (record === null) {
				fail("not_found", "no ship to mark seen", { id });
			}
			record.cascade.seen = true;
			return record;
		});
		await this.history.file(saved.cascade);
		return saved.cascade;
	}

	/** Ends the plan, retaining every completed publication. No later stage may start. */
	async abandon(): Promise<Cascade> {
		const lock = this.storage.lock("ship-start.lock");
		await lock.acquire();
		try {
			const record = await this.record.read();
			if (
				record === null ||
				!["running", "stopped"].includes(record.cascade.status)
			) {
				fail("conflict", "no active ship to abandon");
			}
			record.cascade.status = "abandoned";
			record.cascade.ended = this.stamp();
			// Kept in each step's log, so a later look at the history shows where
			// the person ended the ship and what it was doing.
			for (const step of record.cascade.steps) {
				const running = step.stages.find(
					(stage) => stage.state === "running" || stage.state === "checking",
				);
				if (running !== undefined) {
					await this.log(
						record.cascade.id,
						step.slug,
						`Abandoned by the person at ${record.cascade.ended} while ${step.slug} was at "${running.name}" (${running.state}${step.note === null ? "" : `; last note: ${step.note}`}).\n`,
					);
				}
			}
			await this.save(record);
			this.controller.abort();
			await this.publisher?.stop();
			if (this.going === null) {
				await this.discard(record.cascade);
			}
			return record.cascade;
		} finally {
			await lock.release();
		}
	}

	/** Continue an interrupted ship, rechecking its unfinished stage before doing more work. */
	async resume(): Promise<void> {
		if ((await this.current())?.status === "running") {
			this.run();
		}
	}

	async settled(): Promise<void> {
		await this.going;
	}

	/** Leave the durable stage running for the next server to recheck. */
	async disposeAsync(): Promise<void> {
		this.closing = true;
		this.controller.abort();
		await this.publisher?.stop();
		await this.going;
	}

	private run(): void {
		if (this.going !== null) {
			return;
		}
		this.controller = new AbortController();
		this.going = this.execute()
			.catch((error) => this.opts.error(error))
			.finally(() => {
				this.going = null;
			});
	}

	private async execute(): Promise<void> {
		const execution = this.storage.lock("ship-execution.lock");
		await execution.acquire();
		try {
			const record = await this.record.read();
			if (record === null || record.cascade.status !== "running") {
				return;
			}
			for (const step of record.cascade.steps) {
				if (step.status === "done") {
					continue;
				}
				for (const key of STEP_KEYS.filter((key) =>
					step.stages.some((stage) => stage.key === key),
				)) {
					if (!(await this.active(record))) {
						return;
					}
					const stage = ensure.defined(
						step.stages.find((each) => each.key === key),
					);
					if (stage.state === "done" || stage.state === "skipped") {
						continue;
					}
					Object.assign(
						stage,
						begun({ ...stage, started: null, deadline: null }, this.stamp()),
					);
					stage.log = {
						from: await this.bytes(record.cascade.id, step.slug),
						to: null,
					};
					step.status =
						key === "publish"
							? "shipping"
							: key === "adopt"
								? "bumping"
								: "registry";
					step.note = null;
					await this.save(record);
					try {
						const skipped = await this.perform(record, step, key);
						if (!(await this.active(record))) {
							return;
						}
						Object.assign(
							stage,
							ended(stage, this.stamp(), skipped ? "skipped" : "done"),
						);
						ensure.present(stage.log).to = await this.bytes(
							record.cascade.id,
							step.slug,
						);
						await this.save(record);
					} catch (error) {
						if (!(await this.active(record))) {
							return;
						}
						step.note = error instanceof Error ? error.message : String(error);
						await this.log(record.cascade.id, step.slug, `${step.note}\n`);
						Object.assign(stage, ended(stage, this.stamp(), "failed"));
						ensure.present(stage.log).to = await this.bytes(
							record.cascade.id,
							step.slug,
						);
						step.status = "failed";
						record.cascade.status = "stopped";
						record.cascade.ended = this.stamp();
						await this.save(record);
						return;
					}
				}
				step.status = "done";
				await this.save(record);
			}
			record.cascade.status = "done";
			record.cascade.ended = this.stamp();
			await this.save(record);
		} finally {
			try {
				const current = await this.current();
				if (current?.status === "abandoned") {
					await this.discard(current);
				}
			} finally {
				await execution.release();
			}
		}
	}

	private async perform(
		record: StepRecord,
		step: CascadeStep,
		key: StageKey,
	): Promise<boolean> {
		const _project = ensure.defined(
			record.projects.find((each) => each.slug === step.slug),
		);
		const targets = step.takes.map((use) => {
			const upstream = record.cascade.steps.find(
				(each) => each.slug === use.project,
			);
			const target = ensure.defined(
				record.projects.find((each) => each.slug === use.project),
			);
			return {
				project: target,
				// A project not shipping in this run is taken at the version it is at.
				version:
					upstream?.to ??
					target.version ??
					fail("usage", "upstream target is missing"),
				pins: use.pins,
				waits: upstream?.to != null,
			};
		});
		const pins = targets.flatMap((target) =>
			target.pins.map((pin) => `${pin.name}@${target.version}`),
		);
		if (key === "upstream") {
			const waited = targets.filter((target) => target.waits);
			for (const target of waited) {
				await waitLive(
					this.context(),
					record,
					step,
					target.project,
					target.version,
					key,
				);
			}
			return waited.length === 0;
		}
		if (key === "adopt") {
			// A ship command that declares the adopt step moves its own pins from
			// the versions passed as its `adopt` input, so only a deliberate agent
			// check runs here.
			if (step.adopt !== "agent") {
				return true;
			}
			const adopter = await this.opts.project(step.slug);
			if (!(await this.active(record))) {
				return false;
			}
			const merged = await adopter.adopt(
				record.cascade,
				step,
				{
					goal: `Adopt ${pins.join(", ")} for this ship.`,
					lines: [
						"Check this upstream update for API breaks, and move the project's pins to these versions:",
						...targets.flatMap((target) =>
							target.pins.map(
								(pin) =>
									`${pin.name}: ${pin.version} → ${target.version}. Upstream tags: v${pin.version.replace(/^[~^]/, "")}..v${target.version}`,
							),
						),
					],
				},
				(text) => this.log(record.cascade.id, step.slug, text),
				this.controller.signal,
				() => this.save(record),
			);
			if (!merged) {
				throw new Error("The ship task was removed without merging.");
			}
			return false;
		}
		if (key === "publish") {
			if (pins.length > 0) {
				// The dependent's own ship moves its pins to these versions.
				step.inputs = { ...step.inputs, adopt: pins.join(",") };
			}
			return publishStep(
				this.context(),
				record,
				step,
				await this.opts.project(step.slug),
			);
		}
		return true;
	}

	private context(): StepContext {
		return {
			clock: this.clock,
			signal: this.controller.signal,
			live: this.opts.live,
			pause: this.opts.pause,
			logOf: (id, slug) => this.history.logOf(id, slug),
			active: (record) => this.active(record),
			save: (record) => this.save(record),
			log: (id, slug, text) => this.log(id, slug, text),
			stamp: (after) => this.stamp(after),
			publishing: (shipping) => {
				this.publisher =
					shipping === null ? null : (shipping as StepProject["shipping"]);
			},
		};
	}

	private async discard(ship: Cascade): Promise<void> {
		for (const step of ship.steps) {
			await (await this.opts.project(step.slug)).discard?.(ship, step);
		}
	}

	private async active(record: StepRecord): Promise<boolean> {
		const current = await this.current();
		return (
			!this.closing &&
			current?.id === record.cascade.id &&
			current.status === "running"
		);
	}
	private async save(record: StepRecord): Promise<void> {
		// Abandon can arrive while a process or registry read is in flight. It wins every later save.
		const saved = await this.record.update((current) => {
			if (current?.cascade.id === record.cascade.id) {
				for (const step of record.cascade.steps) {
					if (
						current.cascade.steps.some(
							(each) => each.slug === step.slug && each.sentToAgent,
						)
					) {
						step.sentToAgent = true;
					}
				}
			}
			return current !== null &&
				(current.cascade.id !== record.cascade.id ||
					current.cascade.status === "abandoned")
				? current
				: record;
		});
		await this.history.file(saved.cascade);
	}
	private stamp(after = Duration.ms(0)): string {
		return new Date(this.clock.now() + after.ms).toISOString();
	}
	private async bytes(id: string, slug: string): Promise<number> {
		return this.fs.readBytes(this.history.logOf(id, slug)).then(
			(bytes) => bytes.byteLength,
			() => 0,
		);
	}
	private async log(id: string, slug: string, text: string): Promise<void> {
		const path = this.history.logOf(id, slug);
		await this.fs.mkdir(path.slice(0, path.lastIndexOf("/")), {
			recursive: true,
		});
		await this.fs.append(path, text);
	}
}
