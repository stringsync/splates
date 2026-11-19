import type {
	Composed,
	Listing,
	Offered,
	Pick,
	RunState,
	Supervise,
	Unshipped,
} from "@splates/server/ship";
import { Dispatcher, type Eventful } from "core/events";
import { firstChoice, type Picks, picksOf } from "./ship-pick-list";

/** Where the Ships page is: picking, choosing what is needed first, or reviewing. */
export type Stage =
	| { at: "pick" }
	| { at: "needed"; offered: Offered[] }
	| { at: "review"; plan: Composed; offered: Offered[]; picks: Pick[] };

/** Everything the Ships page shows, replaced whole on each change. */
export type ShipFlowState = {
	/** The targets, once read. */
	listing: Listing | null;
	/** Why the targets could not be read. */
	failed: string | null;
	/** Each target's unshipped commit count, as far as counted yet. */
	unshipped: Unshipped;
	picks: Picks;
	/** The targets added on the Needed first screen, each with its bump. */
	added: Picks;
	stage: Stage;
	/** A plan is being composed. */
	planning: boolean;
	/** Why the last plan or start was refused. */
	refused: string | null;
	/** The ship is being started. */
	starting: boolean;
	/** The run under way, or null; while there is one, no other can start. */
	active: RunState | null;
	/**
	 * Whether the ship starts supervised, and how many fixes its supervisor
	 * may send by itself; the count stays while it is off.
	 */
	supervise: { on: boolean; budget: number };
};

/** The fixes a supervised ship starts with, and the most the Review screen offers. */
export const SUPERVISE_FIXES = 3;
export const SUPERVISE_MOST = 10;

export type ShipFlowEvents = { changed: undefined };

/** Composes a plan of picks, as the server's plan route does. */
export interface Planner {
	plan(picks: readonly Pick[]): Promise<Composed>;
	/** Starts a ship of `picks`, supervised when given, as the server's start route does. */
	start(picks: readonly Pick[], supervise?: Supervise): Promise<RunState>;
}

/**
 * Takes the Ships page from a pick, through the targets the pick needs
 * shipped first, to the plan to review: one method per control on the page.
 */
// vet-ignore resources-are-disposable: it holds no listener or timer of its own, so there is nothing to let go
export class ShipFlow implements Eventful<ShipFlowEvents> {
	private readonly dispatcher = new Dispatcher<ShipFlowEvents>();
	readonly events = this.dispatcher.events;
	state: ShipFlowState = {
		listing: null,
		failed: null,
		unshipped: {},
		picks: new Map(),
		added: new Map(),
		stage: { at: "pick" },
		planning: false,
		refused: null,
		starting: false,
		active: null,
		supervise: { on: true, budget: SUPERVISE_FIXES },
	};

	constructor(private readonly planner: Planner) {}

	/** The targets as read, or why they could not be. */
	listed(listing: Listing): void {
		this.set({ listing });
	}

	/** Switches supervision of the ship to start on or off. */
	supervising(on: boolean): void {
		this.set({ supervise: { ...this.state.supervise, on } });
	}

	/** Sets the supervisor's fixes, from 1 to {@link SUPERVISE_MOST}. */
	fixes(budget: number): void {
		const kept = Math.min(SUPERVISE_MOST, Math.max(1, Math.round(budget)));
		this.set({ supervise: { ...this.state.supervise, budget: kept } });
	}

	/** The unshipped counts, once they come back. */
	counted(unshipped: Unshipped): void {
		this.set({ unshipped });
	}

	unlisted(error: unknown): void {
		this.set({ failed: messageOf(error) });
	}

	/** The runs under way as read on opening the page; the first is the one. */
	underWay(runs: readonly RunState[]): void {
		this.set({
			active: runs.find((run) => run.status === "running") ?? null,
		});
	}

	/** The newest run, read when none runs: one that failed is still the active ship. */
	newest(run: RunState | undefined): void {
		if (this.state.active === null && run?.status === "failed") {
			this.set({ active: run });
		}
	}

	/** Run `run` moved, as the page's stream says: under way, or over. */
	moved(run: RunState): void {
		const { active } = this.state;
		if (
			run.status === "running" ||
			(run.status === "failed" && active?.id === run.id)
		) {
			this.set({ active: run });
		} else if (active?.id === run.id) {
			this.set({ active: null });
		}
	}

	pick(picks: Picks): void {
		this.set({ picks });
	}

	add(added: Picks): void {
		this.set({ added });
	}

	/** Next on the pick: Needed first when the picks depend on others, or Review. */
	async next(): Promise<void> {
		const { stage, picks, added, listing } = this.state;
		if (stage.at === "pick") {
			const plan = await this.compose(picks);
			if (plan === null) {
				return;
			}
			if (plan.offered.length === 0) {
				this.set({
					stage: { at: "review", plan, offered: [], picks: picksOf(picks) },
				});
				return;
			}
			const served = new Map(
				(listing?.targets ?? []).map((each) => [each.plan.name, each]),
			);
			this.set({
				added: new Map(
					plan.offered.flatMap((offer) => {
						const target = served.get(offer.name);
						return target === undefined
							? []
							: [[offer.name, firstChoice(target)] as const];
					}),
				),
				stage: { at: "needed", offered: plan.offered },
			});
		} else if (stage.at === "needed") {
			const all = new Map([...added, ...picks]);
			const plan = await this.compose(all);
			if (plan !== null) {
				this.set({
					stage: {
						at: "review",
						plan,
						offered: stage.offered,
						picks: picksOf(all),
					},
				});
			}
		}
	}

	/**
	 * Starts the ship the Review screen shows and is back on an empty pick
	 * for the next, the run in hand to show; a refusal stays under the steps.
	 */
	async ship(): Promise<RunState | null> {
		const { stage, starting, active } = this.state;
		// A failed ship is still shown as active but holds nothing back.
		if (
			stage.at !== "review" ||
			starting ||
			(active !== null && active.status === "running")
		) {
			return null;
		}
		this.set({ starting: true, refused: null });
		try {
			const { on, budget } = this.state.supervise;
			const run = await this.planner.start(
				reviewed(stage.picks, stage.plan),
				on ? { budget } : undefined,
			);
			this.set({
				active: run.status === "running" ? run : this.state.active,
				starting: false,
				picks: new Map(),
				added: new Map(),
				stage: { at: "pick" },
			});
			return run;
		} catch (error) {
			this.set({ starting: false, refused: messageOf(error) });
			return null;
		}
	}

	/** Back a screen: from Review to Needed first when it was shown, else to the pick. */
	back(): void {
		const { stage } = this.state;
		this.set({
			refused: null,
			stage:
				stage.at === "review" && stage.offered.length > 0
					? { at: "needed", offered: stage.offered }
					: { at: "pick" },
		});
	}

	private async compose(from: Picks): Promise<Composed | null> {
		this.set({ planning: true, refused: null });
		try {
			const plan = await this.planner.plan(picksOf(from));
			this.set({ planning: false });
			return plan;
		} catch (error) {
			this.set({ planning: false, refused: messageOf(error) });
			return null;
		}
	}

	private set(change: Partial<ShipFlowState>): void {
		this.state = { ...this.state, ...change };
		this.dispatcher.dispatch("changed");
	}
}

/**
 * `picks` as reviewed: a target whose plan resolved a version ships at that
 * exact version, so a bump is not resolved again, perhaps differently, on
 * starting.
 */
function reviewed(picks: readonly Pick[], plan: Composed): Pick[] {
	const versions = new Map(
		plan.targets.flatMap((each) =>
			each.version === undefined ? [] : [[each.name, each.version] as const],
		),
	);
	return picks.map((pick) => {
		const version = versions.get(pick.name);
		return version === undefined ? pick : { name: pick.name, version };
	});
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
