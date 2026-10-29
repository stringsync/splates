import { type IdProvider, UuidProvider } from "webappwiz/id";
import { SystemWallClock, type WallClock } from "webappwiz/time";
import { fail } from "../exit";
import type { Document, Storage } from "../storage";
import type { Cascade } from "./cascade";
import type { ShipGraph } from "./graph";
import {
	edited,
	planRun,
	type ShipBump,
	type ShipEdit,
	type ShipPlan,
	ShipPlanError,
	type ShipStep,
	shipName,
} from "./plan";

/**
 * The ship the conversation drives. The server holds its state and refuses a
 * command out of turn: the agent builds the plan with `set`, `leaveOut` and
 * `note`, `propose` freezes it, and only the person's `approve` starts the
 * cascade from exactly that plan. Any change after a proposal unfreezes it.
 */
export class ShipRuns {
	private readonly record: Document<ShipRun>;
	private readonly ids: IdProvider;
	private readonly clock: WallClock;
	private order: Promise<unknown> = Promise.resolve();

	constructor(private readonly opts: ShipRunsOptions) {
		this.record = opts.storage.document<ShipRun>("ship-run.json");
		this.ids = opts.ids ?? new UuidProvider();
		this.clock = opts.clock ?? new SystemWallClock();
	}

	/** The run, or null when none ever started, with its state as the cascade has it. */
	current(): Promise<ShipRun | null> {
		return this.serially(() => this.sync());
	}

	/** The run and the plan it would take now. */
	show(): Promise<ShownRun> {
		return this.serially(async () => {
			const run =
				(await this.sync()) ?? fail("not_found", "no ship is planned");
			return this.shown(run);
		});
	}

	/**
	 * Starts planning a ship of `projects`; none after a stopped run recovers
	 * it, taking what it published as fixed inputs.
	 */
	start(projects: string[]): Promise<ShownRun> {
		return this.serially(async () => {
			const old = await this.sync();
			if (old !== null && old.state !== "stopped" && old.state !== "done") {
				fail(
					"conflict",
					`a ship of ${shipName(old.from)} is ${old.state}: finish or abandon it first`,
				);
			}
			const recovery =
				projects.length === 0 && old?.state === "stopped"
					? (old.cascade ??
						fail("conflict", "the stopped ship kept no cascade"))
					: undefined;
			if (projects.length === 0 && recovery === undefined) {
				fail("usage", "name the projects to ship");
			}
			const graph = await this.opts.graph();
			const names =
				old === null || recovery === undefined ? projects : old.projects;
			for (const slug of names) {
				if (!graph.projects.some((each) => each.slug === slug)) {
					fail("not_found", `no registered project is named ${slug}`);
				}
			}
			const run: ShipRun = {
				id: this.ids.next(),
				from: names.length === 1 ? (names[0] as string) : CHANGED_RUN,
				projects: [...new Set(names)],
				...(recovery === undefined ? {} : { recovery }),
				state: "planning",
				started: new Date(this.clock.now()).toISOString(),
				edits: {},
				skipped: [],
			};
			// Drawn once so a project that cannot ship refuses the start.
			await this.draw(run);
			await this.record.write(run);
			return this.shown(run);
		});
	}

	/** Sets the release type and reasons of a project that ships. */
	set(
		slug: string,
		change: { bump?: ShipBump; why?: string },
	): Promise<ShownRun> {
		return this.edit((run, plan) => {
			if (change.bump === undefined && change.why === undefined) {
				fail("usage", "set needs `--bump` or `--why`");
			}
			const step = plan.steps.find((each) => each.slug === slug);
			if (step === undefined || step.action !== "ship") {
				fail("usage", `${slug} has no release in this plan`);
			}
			run.edits[slug] = {
				...run.edits[slug],
				...(change.bump === undefined ? {} : { bump: change.bump }),
				...(change.why === undefined ? {} : { why: change.why }),
			};
		});
	}

	/** Leaves a dependent out of the plan, with whatever only it reaches. */
	leaveOut(slug: string): Promise<ShownRun> {
		return this.edit((run, plan) => {
			if (run.projects.includes(slug)) {
				fail("usage", `${slug} is one the person picked to ship`);
			}
			if (run.recovery !== undefined) {
				fail("usage", "a recovery plan cannot leave projects out");
			}
			if (!plan.steps.some((each) => each.slug === slug)) {
				fail("usage", `${slug} is not a dependent in this plan`);
			}
			run.skipped = [...new Set([...run.skipped, slug])];
		});
	}

	/** Notes what adopting the upstream releases needs in a project of the plan. */
	note(slug: string, adopt: string): Promise<ShownRun> {
		return this.edit((run, plan) => {
			if (adopt.trim() === "") {
				fail("usage", "a note needs words");
			}
			if (!plan.steps.some((each) => each.slug === slug)) {
				fail("usage", `${slug} is not in this plan`);
			}
			run.edits[slug] = { ...run.edits[slug], adopt };
		});
	}

	/**
	 * Validates and freezes the plan, answering with the card for the agent to
	 * post. Proposing again with nothing changed answers the same card.
	 */
	propose(): Promise<ShownRun> {
		return this.serially(async () => {
			const run =
				(await this.sync()) ?? fail("not_found", "no ship is planned");
			if (run.state === "proposed") {
				return this.shown(run);
			}
			this.expect(run, "planning", "propose");
			const plan = await this.draw(run);
			if (plan.steps.length === 0) {
				fail("conflict", "nothing remains to ship");
			}
			for (const step of plan.steps) {
				if (step.action === "ship" && step.to === null) {
					fail(
						"usage",
						`${step.slug}'s version is not x.y.z, so no version can be planned`,
					);
				}
			}
			for (const slug of run.projects) {
				const edit = run.edits[slug];
				if (
					run.recovery === undefined &&
					(edit?.bump === undefined || edit.why === undefined)
				) {
					fail(
						"usage",
						`${slug} needs a release type and reasons: \`ship plan set ${slug} --bump <type> --why "<reasons>"\``,
					);
				}
			}
			run.frozen = { ...plan, id: this.ids.next() };
			run.state = "proposed";
			await this.record.write(run);
			return this.shown(run);
		});
	}

	/**
	 * Starts the cascade from the frozen plan `id` the person approved, once
	 * the projects still draw it; refused for any other plan or state.
	 */
	approve(id: string): Promise<ShipRun> {
		return this.serially(async () => {
			const run =
				(await this.sync()) ?? fail("not_found", "no ship is planned");
			this.expect(run, "proposed", "approve");
			const frozen = run.frozen;
			if (frozen === undefined || frozen.id !== id) {
				fail("conflict", "the ship plan changed; reopen it and plan again");
			}
			const fresh = await this.draw(run);
			if (JSON.stringify({ ...fresh, id }) !== JSON.stringify(frozen)) {
				fail("conflict", "the projects changed; plan the ship again");
			}
			run.state = "approved";
			await this.record.write(run);
			try {
				const { cascade, started } = await this.opts.cascades.startPlan(frozen);
				if (!started) {
					fail("conflict", "another ship is already under way");
				}
				run.cascade = cascade.id;
				run.state = "running";
			} catch (error) {
				run.state = "proposed";
				await this.record.write(run);
				throw error;
			}
			await this.record.write(run);
			return run;
		});
	}

	/** Applies `change` to a run in planning (a proposed one unfreezes), then redraws it. */
	private edit(
		change: (run: ShipRun, plan: ShipPlan) => void,
	): Promise<ShownRun> {
		return this.serially(async () => {
			const run =
				(await this.sync()) ?? fail("not_found", "no ship is planned");
			if (run.state === "proposed") {
				run.state = "planning";
				delete run.frozen;
			}
			this.expect(run, "planning", "change the plan of");
			change(run, await this.draw(run));
			// A project dropped from the plan keeps none of what was set on it.
			const left = await this.draw(run);
			for (const slug of Object.keys(run.edits)) {
				if (!left.steps.some((each) => each.slug === slug)) {
					delete run.edits[slug];
				}
			}
			await this.record.write(run);
			return this.shown(run);
		});
	}

	private expect(run: ShipRun, state: RunState, doing: string): void {
		if (run.state !== state) {
			fail(
				"conflict",
				`cannot ${doing} a ship that is ${run.state}${run.state === "stopped" ? ": `ship start` with no projects plans its recovery" : ""}`,
				{ state: run.state },
			);
		}
	}

	/** The run as the cascade it started has it: ended runs stop or finish here. */
	private async sync(): Promise<ShipRun | null> {
		const run = await this.record.read();
		if (run?.state !== "running") {
			return run;
		}
		const cascade = await this.opts.cascades.current();
		if (
			cascade === null ||
			cascade.id !== run.cascade ||
			cascade.status === "running"
		) {
			return run;
		}
		run.state = cascade.status === "done" ? "done" : "stopped";
		await this.record.write(run);
		return run;
	}

	/** The plan `run` draws now from the graph, or its recovery, with what was set. */
	private async draw(run: ShipRun): Promise<ShipPlan> {
		const edits = new Map(Object.entries(run.edits));
		try {
			if (run.recovery !== undefined) {
				if (this.opts.recover === undefined) {
					fail("usage", "ship recovery is unavailable");
				}
				const base = await this.opts.recover(run.recovery);
				return {
					...base,
					steps: base.steps.map((step: ShipStep) => edited(step, edits)),
				};
			}
			return planRun(
				await this.opts.graph(),
				run.from,
				new Map(run.projects.map((slug) => [slug, "the project shipped"])),
				edits,
				run.skipped,
			);
		} catch (error) {
			if (error instanceof ShipPlanError) {
				fail(error.reason, error.message);
			}
			throw error;
		}
	}

	private async shown(run: ShipRun): Promise<ShownRun> {
		if (run.state === "proposed" && run.frozen !== undefined) {
			return { run, plan: run.frozen, card: planCard(run.frozen) };
		}
		if (run.state !== "planning") {
			return { run, plan: run.frozen ?? null };
		}
		return { run, plan: await this.draw(run) };
	}

	private serially<T>(work: () => Promise<T>): Promise<T> {
		const next = this.order.then(work, work);
		this.order = next.catch(() => undefined);
		return next;
	}
}

/** What a run of several projects is named from: no slug, since a slug has no `+`. */
const CHANGED_RUN = "+changed";

/** The card the agent posts for the person to approve `plan`. */
export function planCard(plan: ShipPlan): string {
	const lines = [
		`## 🔐 Permission: ship plan: ${shipName(plan.from)}`,
		"",
		`Plan: \`${plan.id}\``,
		"",
	];
	plan.steps.forEach((step, i) => {
		const release =
			step.action === "ship"
				? `ships ${step.from ?? "?"} → ${step.to ?? "?"} (${step.bump})`
				: "takes its bump";
		lines.push(`${i + 1}. ${step.slug} ${release}`, `   ${step.why}`);
		const takes = step.takes.flatMap((use) =>
			use.pins.map((pin) => `${pin.name}@${pin.version}`),
		);
		if (takes.length > 0) {
			lines.push(`   Takes: ${takes.join(", ")}`);
		}
		if (step.adopt !== undefined) {
			lines.push(`   Adopting: ${step.adopt}`);
		}
	});
	if (plan.skipped !== undefined) {
		lines.push("", `Left out: ${plan.skipped.join(", ")}`);
	}
	return lines.join("\n");
}

/**
 * Where a ship stands: `planning` while the conversation builds the plan,
 * `proposed` once it is frozen for the person, `approved` for the moment the
 * person's approval starts the cascade, `running` while it ships, `stopped`
 * once it stopped or was abandoned, `done` once every project shipped.
 */
export type RunState =
	| "planning"
	| "proposed"
	| "approved"
	| "running"
	| "stopped"
	| "done";

/** A ship as the conversation drives it: what to ship, what it set, and the plan it froze. */
export interface ShipRun {
	id: string;
	/** The project it starts from, or {@link CHANGED} for several. */
	from: string;
	/** The projects the person picked to ship. */
	projects: string[];
	/** The stopped cascade whose published versions this run takes as fixed inputs. */
	recovery?: string;
	state: RunState;
	started: string;
	/** What the agent set per project. */
	edits: Record<string, ShipEdit>;
	/** The dependents the agent left out. */
	skipped: string[];
	/** The plan the person is asked to approve; present only while proposed on. */
	frozen?: ShipPlan;
	/** The cascade it started, once approved. */
	cascade?: string;
}

/** What {@link ShipRuns} works with. */
export interface ShipRunsOptions {
	storage: Storage;
	/** Every registered project and who pins whose packages. */
	graph: () => Promise<ShipGraph>;
	/** The plan finishing the stopped cascade `id`, its published versions fixed. */
	recover?: (id: string) => Promise<ShipPlan>;
	cascades: {
		current: () => Promise<Cascade | null>;
		startPlan: (
			plan: ShipPlan,
		) => Promise<{ cascade: Cascade; started: boolean }>;
	};
	ids?: IdProvider;
	clock?: WallClock;
}

/** The run with the plan it would take now. */
export interface ShownRun {
	run: ShipRun;
	/** The frozen plan while proposed, else the plan as drawn now; null once it started. */
	plan: ShipPlan | null;
	/** The card to post for the person while proposed. */
	card?: string;
}
