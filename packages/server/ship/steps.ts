import { aborts } from "webappwiz/abort";
import { ensure } from "webappwiz/assert";
import type { AsyncResource } from "webappwiz/disposable";
import type { Fs } from "webappwiz/system";
import {
	Duration,
	SystemWallClock,
	sleep,
	type WallClock,
} from "webappwiz/time";
import { fail } from "../exit";
import type { Storage } from "../storage";
import { type Cascade, type CascadeStep, Cascades } from "./cascade";
import type { Pin, ShipGraph, ShipProject } from "./graph";
import { REGISTRY_DEADLINE, type ShipLive } from "./live";
import type { ShipRegistry } from "./registry";
import type { Ship, Shipping } from "./run";
import {
	SHIP_SELECTION,
	type ShipSelection,
	ShipSelections,
} from "./selection";
import { begun, ended, type StageKey } from "./stages";

/** A new ship keeps its project snapshots alongside the legacy-compatible timeline. */
interface StepRecord {
	cascade: Cascade;
	projects: ShipProject[];
}

/** A project’s publisher and adoption operations, including cleanup after Abandon. */
export interface StepProject {
	shipping: Pick<Shipping, "start" | "resume" | "settled" | "current" | "stop">;
	adopt(
		ship: Cascade,
		step: CascadeStep,
		pins: Pin[],
		log: (text: string) => Promise<void>,
		signal: AbortSignal,
		assigned?: () => Promise<void>,
	): Promise<boolean | undefined>;
	discard?(ship: Cascade, step: CascadeStep): Promise<void>;
}

export interface ShipStepsOptions {
	graph(): Promise<ShipGraph>;
	project(slug: string): Promise<StepProject>;
	live: Pick<ShipLive, "check">;
	registry: Pick<ShipRegistry, "published">;
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
	private publisher: StepProject["shipping"] | null = null;
	constructor(
		private readonly storage: Storage,
		private readonly fs: Fs,
		private readonly opts: ShipStepsOptions,
	) {
		super(storage, fs);
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
				await this.opts.graph(),
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
			record.cascade.status = "running";
			record.cascade.ended = null;
			await this.save(record);
			this.run();
			return record.cascade;
		} finally {
			await lock.release();
		}
	}

	/** Give a failed mechanical adoption to an agent, retaining its prepared tree. */
	async handToAgent(): Promise<Cascade> {
		const record = await this.record.read();
		const step = record?.cascade.steps.find((each) =>
			each.stages.some(
				(stage) => stage.key === "adopt" && stage.state === "failed",
			),
		);
		if (
			record?.cascade.status !== "stopped" ||
			step === undefined ||
			step.adopt === "agent" ||
			this.going !== null
		) {
			fail("conflict", "no failed mechanical adoption to hand to an agent");
		}
		step.adopt = "agent";
		step.adoptFailure = step.note ?? "Mechanical adoption failed";
		await this.save(record);
		return this.retry();
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
				for (const key of STEP_KEYS) {
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
		const project = ensure.defined(
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
		if (key === "upstream") {
			const waited = targets.filter((target) => target.waits);
			for (const target of waited) {
				await this.waitLive(record, step, target.project, target.version, key);
			}
			return waited.length === 0;
		}
		if (key === "adopt") {
			if (targets.length === 0 && step.adopt !== "agent") {
				return true;
			}
			const pins = targets.flatMap((target) =>
				target.pins.map((pin) => ({ name: pin.name, version: target.version })),
			);
			const adopter = await this.opts.project(step.slug);
			if (!(await this.active(record))) {
				return false;
			}
			const skipped = await adopter.adopt(
				record.cascade,
				step,
				pins,
				(text) => this.log(record.cascade.id, step.slug, text),
				this.controller.signal,
				() => this.save(record),
			);
			return skipped === true;
		}
		if (key === "publish") {
			const published = [];
			for (const name of step.publishes) {
				published.push(
					await this.opts.registry.published(name, ensure.present(step.to)),
				);
			}
			if (published.every(Boolean)) {
				step.published = step.publishes.map((name) => ({
					name,
					version: ensure.present(step.to),
				}));
				return true;
			}
			const shipping = (await this.opts.project(step.slug)).shipping;
			this.publisher = shipping;
			try {
				const left = await shipping.current();
				if (!(await this.active(record))) {
					return false;
				}
				if (left?.status === "running") {
					if (
						left.log !== this.history.logOf(record.cascade.id, step.slug) ||
						left.bump !== step.bump
					) {
						throw new Error(
							"another publish is already running for this project",
						);
					}
					await shipping.resume();
				} else {
					const ship = await shipping.start(ensure.present(step.bump), {
						log: this.history.logOf(record.cascade.id, step.slug),
					});
					step.ship = ship.started;
					if (!(await this.active(record))) {
						await shipping.stop();
					}
				}
				await shipping.settled();
				const ship = await shipping.current();
				if (ship?.status !== "done") {
					throw new Error(ship?.error ?? "publish did not finish");
				}
				if (ship.to !== step.to) {
					throw new Error(`published ${ship.to}, expected ${step.to}`);
				}
			} finally {
				this.publisher = null;
			}
			step.published = step.publishes.map((name) => ({
				name,
				version: ensure.present(step.to),
			}));
			return false;
		}
		if (step.action === "bump") {
			return true;
		}
		await this.waitLive(record, step, project, ensure.present(step.to), key);
		return false;
	}

	private async waitLive(
		record: StepRecord,
		step: CascadeStep,
		project: ShipProject,
		version: string,
		key: StageKey,
	): Promise<void> {
		const stage = ensure.defined(step.stages.find((each) => each.key === key));
		const until = this.clock.now() + REGISTRY_DEADLINE.ms;
		stage.deadline = new Date(until).toISOString();
		stage.state = "checking";
		while (await this.active(record)) {
			const check = await this.opts.live.check(project, version);
			stage.check = {
				at: this.stamp(),
				result: check.live
					? `${project.slug}@${version} is live`
					: check.lagging
							.map((each) => `${each.name}: ${each.deployed ?? "not live"}`)
							.join(", "),
			};
			await this.log(record.cascade.id, step.slug, `${stage.check.result}\n`);
			await this.save(record);
			if (check.live) {
				return;
			}
			if (this.clock.now() >= until) {
				throw new Error(
					`timed out waiting for ${project.slug}@${version} to go live`,
				);
			}
			await aborts.race(
				this.controller.signal,
				this.opts.pause?.() ?? sleep(Duration.secs(1)),
			);
		}
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
		const saved = await this.record.update((current) =>
			current !== null &&
			(current.cascade.id !== record.cascade.id ||
				current.cascade.status === "abandoned")
				? current
				: record,
		);
		await this.history.file(saved.cascade);
	}
	private stamp(): string {
		return new Date(this.clock.now()).toISOString();
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
