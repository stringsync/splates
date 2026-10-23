import { Duration, SystemWallClock, type WallClock } from "webappwiz/time";
import type { Document } from "../storage";
import {
	type BudgetHeld,
	Kept,
	type KeptFile,
	type Life,
	type WorkerRaise,
} from "./budget-file";
import { reached } from "./budget-notice";
import { windowStart } from "./budget-window";

export type {
	BudgetHeld,
	WorkerBudgetFile,
	WorkerRaise,
} from "./budget-file";
export { span, windowStart } from "./budget-window";

export {
	DEFAULT_RUNNER_CAP,
	DEFAULT_RUNNER_IDLE,
	DEFAULT_RUNNERS_KEPT,
	DEFAULT_WORKER_LIMITS,
	WORKER_LIMITS,
	type WorkerLimit,
} from "./limits";

import {
	DEFAULT_RUNNER_CAP,
	DEFAULT_RUNNER_IDLE,
	DEFAULT_RUNNERS_KEPT,
	DEFAULT_WORKER_LIMITS,
	WORKER_LIMITS,
	type WorkerLimit,
} from "./limits";

/** A worker budget limit reached, like `monthly limit $75.00 reached`. */
export type BudgetReason = `${string} reached`;

/** The shares of a limit, in percent, that each warn once per window. */
export const ALERT_TIERS = [80, 90, 100] as const;

/** A share of a limit reached: none, a warning, or the limit itself. */
export type AlertTier = 0 | (typeof ALERT_TIERS)[number];

/** How long a raise lasts when not told. */
export const RAISE_FOR = Duration.days(1);

/**
 * What made workers may cost, in dollars: a rate cap on what those running
 * at once cost an hour, and limits on what they cost in a day and a month,
 * each warned of at 80% and 90% and holding at 100%. Spend is counted from
 * a ledger of each made worker's life at its type's list price, so every
 * figure is an estimate. Kept in a document, so a restart forgets none of it.
 *
 * It is scry's budgets in dollars: the same windows, from the start of the
 * day or month in local time, and raises on top of a limit for a while.
 * Where scry counts tokens per check, this counts worker-hours as they
 * pass, and the rate cap has no scry counterpart.
 */
export class WorkerBudget {
	/** Serializes writes, so two changes never race to the file. */
	private writing: Promise<void> = Promise.resolve();

	private constructor(
		private readonly document: Document<KeptFile> | null,
		private readonly wall: WallClock,
		private kept: KeptFile,
	) {}

	/** Reads what `document` keeps, or starts at the defaults when it keeps nothing readable. */
	static async open(
		document: Document<KeptFile>,
		wall: WallClock = new SystemWallClock(),
	): Promise<WorkerBudget> {
		let kept = Kept.parse({});
		try {
			const read = await document.read();
			if (read !== null) {
				kept = Kept.parse(read);
			}
		} catch {
			// Unreadable: the defaults hold, and no spend is known.
		}
		return new WorkerBudget(document, wall, kept);
	}

	/** A budget kept in memory alone. */
	static memory(wall: WallClock = new SystemWallClock()): WorkerBudget {
		return new WorkerBudget(null, wall, Kept.parse({}));
	}

	/** Where each limit stands now. */
	standing(): WorkerStanding[] {
		const now = this.wall.now();
		return WORKER_LIMITS.map((limit) => {
			const set = this.kept.limits[limit];
			const raised = this.raises
				.filter((raise) => raise.limit === limit)
				.reduce((sum, raise) => sum + raise.dollars, 0);
			const dollars = (set ?? DEFAULT_WORKER_LIMITS[limit]) + raised;
			const since = windowStart(limit, now);
			const spent =
				limit === "hour" ? this.rate() : this.spentSince(since, now);
			return {
				limit,
				window: WINDOW_NAMES[limit],
				since,
				dollars,
				raised,
				set: set !== undefined,
				spent,
				left: Math.max(0, dollars - spent),
				tier: tierOf(spent, dollars),
				estimate: true,
			};
		});
	}

	/** How many runners may be up at once in the account: the set cap, else the default. */
	runnerCap(): number {
		return this.kept.runners ?? DEFAULT_RUNNER_CAP;
	}

	/** How long a runner made now runs after its last job before it stops itself: the set tail, else the default. */
	runnerIdle(): Duration {
		return this.kept.idle === undefined
			? DEFAULT_RUNNER_IDLE
			: Duration.secs(this.kept.idle);
	}

	/** Whether the idle tail was set, over its default. */
	runnerIdleSet(): boolean {
		return this.kept.idle !== undefined;
	}

	/**
	 * Sets the idle tail of runners made from now on to `idle`, a whole
	 * number of seconds at least one; null gives it back to its default.
	 */
	async setRunnerIdle(idle: Duration | null): Promise<void> {
		const secs = idle === null ? null : Math.round(idle.ms / 1000);
		if (secs !== null && secs < 1) {
			throw new Error("a runner's idle tail is at least a second");
		}
		await this.change((kept) => {
			const { idle: _, ...rest } = kept;
			return {
				...rest,
				...(secs === null ? {} : { idle: secs }),
				reviewed: true,
			};
		});
	}

	/** How many stopped runners the server keeps: the set count, else the default. */
	runnersKept(): number {
		return this.kept.keptStopped ?? DEFAULT_RUNNERS_KEPT;
	}

	/** Whether the kept count was set, over its default. */
	runnersKeptSet(): boolean {
		return this.kept.keptStopped !== undefined;
	}

	/** Sets how many stopped runners the server keeps to `count`, a whole number; null gives it back to its default. */
	async setRunnersKept(count: number | null): Promise<void> {
		if (count !== null && !(Number.isInteger(count) && count >= 0)) {
			throw new Error(
				`expected a whole number of runners to keep, like 4, got ${count}`,
			);
		}
		await this.change((kept) => {
			const { keptStopped: _, ...rest } = kept;
			return {
				...rest,
				...(count === null ? {} : { keptStopped: count }),
				reviewed: true,
			};
		});
	}

	/** Where the runner cap stands with `up` runners in the account now; `up` is null when not known. */
	runnersStanding(up: number | null): RunnersStanding {
		const cap = this.runnerCap();
		return {
			cap,
			set: this.kept.runners !== undefined,
			up,
			left: up === null ? cap : Math.max(0, cap - up),
			tier: up === null ? 0 : tierOf(up, cap),
		};
	}

	/**
	 * Why no runner may be made with `up` in the account now; null while the
	 * cap leaves room. Unlike the dollar limits it stops none already up.
	 */
	runnersRefusal(up: number): BudgetReason | null {
		const cap = this.runnerCap();
		return up >= cap ? `runner limit ${cap} reached` : null;
	}

	/**
	 * Sets the runner cap to `runners`; null gives it back to its default.
	 * Either way the user has chosen, so the budget counts as reviewed.
	 */
	async setRunners(runners: number | null): Promise<void> {
		if (runners !== null && !(Number.isInteger(runners) && runners >= 0)) {
			throw new Error(
				`expected a whole number of runners, like 16, got ${runners}`,
			);
		}
		await this.change((kept) => {
			const { runners: _, ...rest } = kept;
			return {
				...rest,
				...(runners === null ? {} : { runners }),
				reviewed: true,
			};
		});
	}

	/**
	 * Why no worker costing `dollarsPerHour` may be made now; null when the
	 * budget allows it. The rate cap counts it on top of those running; the
	 * day and month hold once reached.
	 */
	refusal(dollarsPerHour: number): BudgetReason | null {
		const holding = this.holding(dollarsPerHour);
		return holding === null ? null : reached(holding.standing);
	}

	/**
	 * What a raise must add for a worker costing `dollarsPerHour` to be made
	 * now, to the limit that holds it, rounded up to the cent; null when
	 * none does. The rate cap needs only what the worker overshoots it by;
	 * the day and month, the overshoot and an hour of the worker.
	 */
	shortfall(
		dollarsPerHour: number,
	): { limit: WorkerLimit; dollars: number } | null {
		const holding = this.holding(dollarsPerHour);
		if (holding === null) {
			return null;
		}
		const { standing } = holding;
		const need =
			standing.limit === "hour"
				? standing.spent + dollarsPerHour - standing.dollars
				: standing.spent - standing.dollars + dollarsPerHour;
		return {
			limit: standing.limit,
			dollars: Math.max(0.01, Math.ceil(need * 100 - 1e-6) / 100),
		};
	}

	private holding(dollarsPerHour: number): { standing: WorkerStanding } | null {
		for (const standing of this.standing()) {
			const over =
				standing.limit === "hour"
					? standing.spent + dollarsPerHour > standing.dollars + EPSILON
					: standing.spent >= standing.dollars - EPSILON;
			if (over) {
				return { standing };
			}
		}
		return null;
	}

	/**
	 * Why made workers must stop: the day's or month's limit reached; null
	 * while both have something left. The rate cap stops none, since those
	 * running were let in under it.
	 */
	stopped(): BudgetReason | null {
		const standing = this.standing().find(
			(each) => each.limit !== "hour" && each.spent >= each.dollars - EPSILON,
		);
		return standing === undefined ? null : reached(standing);
	}

	/** The ids of the workers counted as running now. */
	running(): string[] {
		return this.kept.lives
			.filter((life) => life.until === null && !life.stopped)
			.map((life) => life.id);
	}

	/** The ids of the workers counted now, running or stopped and kept. */
	counted(): string[] {
		return [
			...new Set(
				this.kept.lives
					.filter((life) => life.until === null)
					.map((life) => life.id),
			),
		];
	}

	/** What made workers running now cost an hour together. */
	rate(): number {
		return this.kept.lives
			.filter((life) => life.until === null && !life.stopped)
			.reduce((sum, life) => sum + life.dollarsPerHour, 0);
	}

	/**
	 * What made workers come to this month if those running now run to its
	 * end, local time: an estimate.
	 */
	projected(): number {
		const now = this.wall.now();
		const end = new Date(windowStart("month", now));
		end.setMonth(end.getMonth() + 1);
		return (
			this.spentSince(windowStart("month", now), now) +
			(this.rate() * (end.getTime() - now)) / HOUR
		);
	}

	/** The raises not yet run out. */
	get raises(): WorkerRaise[] {
		const now = this.wall.now();
		return this.kept.raises.filter((raise) => raise.until > now);
	}

	/** Whether the user has set a limit, or confirmed the defaults, as setup asks. */
	get reviewed(): boolean {
		return this.kept.reviewed;
	}

	/**
	 * Sets `limit` to `dollars`; null gives it back to its default. Either
	 * way the user has chosen, so the budget counts as reviewed.
	 */
	async set(limit: WorkerLimit, dollars: number | null): Promise<void> {
		if (dollars !== null) {
			checkDollars(dollars);
		}
		await this.change((kept) => {
			const limits = { ...kept.limits };
			if (dollars === null) {
				delete limits[limit];
			} else {
				limits[limit] = dollars;
			}
			return { ...kept, limits, reviewed: true };
		});
	}

	/**
	 * Gives every limit back to its default and forgets that the user chose,
	 * as undoing setup does; raises and spend stay.
	 */
	async unreview(): Promise<void> {
		await this.change((kept) => {
			const { runners: _, idle: __, keptStopped: ___, ...rest } = kept;
			return { ...rest, limits: {}, reviewed: false };
		});
	}

	/** Adds `dollars` to `limit` for `span`, answering the raise. */
	async raise(
		limit: WorkerLimit,
		dollars: number,
		span: Duration = RAISE_FOR,
	): Promise<WorkerRaise> {
		checkDollars(dollars);
		const from = this.wall.now();
		const raise = {
			id: Math.max(0, ...this.kept.raises.map((each) => each.id)) + 1,
			limit,
			dollars,
			from,
			until: from + span.ms,
		};
		await this.change((kept) => ({
			...kept,
			raises: [...this.liveRaises(kept), raise],
		}));
		return raise;
	}

	/** Ends raise `id` now; answers whether there was one. */
	async endRaise(id: number): Promise<boolean> {
		const found = this.raises.some((raise) => raise.id === id);
		if (found) {
			await this.change((kept) => ({
				...kept,
				raises: this.liveRaises(kept).filter((raise) => raise.id !== id),
			}));
		}
		return found;
	}

	/** Counts worker `id` as costing `dollarsPerHour` from now on, its storage while stopped no more. */
	async started(
		id: string,
		type: string,
		dollarsPerHour: number,
	): Promise<void> {
		const from = this.wall.now();
		await this.change((kept) => ({
			...kept,
			lives: [
				...this.recent(kept)
					.filter(
						(life) => !(life.id === id && life.until === null && !life.stopped),
					)
					.map((life) =>
						life.id === id && life.until === null
							? { ...life, until: Math.max(life.from, from) }
							: life,
					),
				{ id, type, dollarsPerHour, from, until: null, stopped: false },
			],
		}));
	}

	/**
	 * Counts worker `id`, stopped now or at `at` and kept to start again, at
	 * `stoppedDollarsPerHour`, its storage alone, until it starts or is
	 * destroyed; silent for one not counted as running.
	 */
	async slept(
		id: string,
		stoppedDollarsPerHour: number,
		at?: number,
	): Promise<void> {
		const life = this.kept.lives.find(
			(each) => each.id === id && each.until === null && !each.stopped,
		);
		if (life === undefined) {
			return;
		}
		await this.ended(id, at);
		if (stoppedDollarsPerHour > 0) {
			const from = Math.max(life.from, at ?? this.wall.now());
			await this.change((kept) => ({
				...kept,
				lives: [
					...kept.lives,
					{
						id,
						type: life.type,
						dollarsPerHour: stoppedDollarsPerHour,
						from,
						until: null,
						stopped: true,
					},
				],
			}));
		}
	}

	/** Stops counting worker `id`, destroyed or stopped now, or at `at`, its storage too; silent for one not counted. */
	async ended(id: string, at?: number): Promise<void> {
		const until = at ?? this.wall.now();
		if (
			!this.kept.lives.some((life) => life.id === id && life.until === null)
		) {
			return;
		}
		await this.change((kept) => ({
			...kept,
			lives: kept.lives.map((life) =>
				life.id === id && life.until === null
					? { ...life, until: Math.max(life.from, until) }
					: life,
			),
		}));
	}

	/**
	 * Each tier a limit has reached in its window that has not been alerted
	 * yet, its highest alone, marked alerted, so each is told once per window.
	 */
	async alerts(): Promise<WorkerAlert[]> {
		const fresh: WorkerAlert[] = [];
		for (const standing of this.standing()) {
			if (standing.tier === 0) {
				continue;
			}
			const told = this.kept.alerted.find(
				(each) =>
					each.limit === standing.limit && each.since === standing.since,
			);
			if (told === undefined || told.tier < standing.tier) {
				fresh.push({ standing, tier: standing.tier });
			}
		}
		if (fresh.length > 0) {
			await this.change((kept) => ({
				...kept,
				alerted: [
					...kept.alerted.filter(
						(each) =>
							!fresh.some((alert) => alert.standing.limit === each.limit),
					),
					...fresh.map(({ standing, tier }) => ({
						limit: standing.limit,
						since: standing.since,
						tier,
					})),
				],
			}));
		}
		return fresh;
	}

	/**
	 * The conversations a hard stop checkpointed, which carry on once the
	 * budget allows again.
	 */
	get held(): BudgetHeld[] {
		return this.kept.held;
	}

	/** Keeps `held` with those a hard stop checkpointed before. */
	async hold(held: BudgetHeld[]): Promise<void> {
		const known = (each: BudgetHeld) => `${each.project}\0${each.conversation}`;
		await this.change((kept) => {
			const already = new Set(kept.held.map(known));
			return {
				...kept,
				held: [
					...kept.held,
					...held.filter((each) => !already.has(known(each))),
				],
			};
		});
	}

	/** Forgets every conversation held, answering them, for them to carry on. */
	async release(): Promise<BudgetHeld[]> {
		const { held } = this.kept;
		if (held.length > 0) {
			await this.change((kept) => ({ ...kept, held: [] }));
		}
		return held;
	}

	/** Dollars made workers cost from `since` to `now`. */
	private spentSince(since: number, now: number): number {
		return this.kept.lives.reduce((sum, life) => {
			const from = Math.max(life.from, since);
			const until = Math.min(life.until ?? now, now);
			return until > from
				? sum + (life.dollarsPerHour * (until - from)) / HOUR
				: sum;
		}, 0);
	}

	private liveRaises(kept: KeptFile): WorkerRaise[] {
		const now = this.wall.now();
		return kept.raises.filter((raise) => raise.until > now);
	}

	/** The lives still counted in some window: running, or ended this month. */
	private recent(kept: KeptFile): Life[] {
		const month = windowStart("month", this.wall.now());
		return kept.lives.filter(
			(life) => life.until === null || life.until > month,
		);
	}

	/**
	 * Applies `next` to what the document keeps now, read again first: `splates
	 * run` counts the runners it makes in the same document as the server,
	 * so neither writes over the other's.
	 */
	private async change(next: (kept: KeptFile) => KeptFile): Promise<void> {
		const document = this.document;
		if (document === null) {
			this.kept = next(this.kept);
			return;
		}
		this.writing = this.writing.then(async () => {
			const read = await document.read().catch(() => null);
			const current = read === null ? null : Kept.safeParse(read);
			this.kept = next(current?.success ? current.data : this.kept);
			await document.write(this.kept);
		});
		await this.writing;
	}
}

/** Where one limit stands. */
export interface WorkerStanding {
	limit: WorkerLimit;
	/** The window, as a report names it: `running now`, `today`, `this month`. */
	window: string;
	/** When the window began, epoch ms: the hour, day or month. */
	since: number;
	/** What may be spent in it, raises included: dollars, or dollars an hour for the rate cap. */
	dollars: number;
	/** How much of `dollars` raises added; 0 for none. */
	raised: number;
	/** Whether the user set it, over the default. */
	set: boolean;
	/** Spent so far in the window, or for the rate cap what the made workers cost an hour now. */
	spent: number;
	left: number;
	tier: AlertTier;
	/** Always true for now: spent is counted at the provider's list price, not its bill. */
	estimate: boolean;
}

/** Where the cap on runners up at once stands. */
export interface RunnersStanding {
	cap: number;
	/** Whether the user set it, over the default. */
	set: boolean;
	/** Runners up in the account now, by the cloud's own list; null when it could not be asked. */
	up: number | null;
	left: number;
	tier: AlertTier;
}

/** What one click on a held queue raises, and what that buys. */
export interface RaiseOffer {
	/** The limit that holds the queue. */
	limit: WorkerLimit;
	/** Dollars to add: an hour's rate for the rate cap, else dollars for the window. */
	dollars: number;
	/** The worker type it would make. */
	type: string;
	platform: string;
	slots: number;
	dollarsPerHour: number;
	/** How many of the queued agents that worker would seat. */
	clears: number;
}

/** A tier one limit has newly reached in its window. */
export interface WorkerAlert {
	standing: WorkerStanding;
	tier: Exclude<AlertTier, 0>;
}

const HOUR = Duration.hrs(1).ms;

/** Slack for sums of prices, so $0.05 five times is not over $0.25. */
const EPSILON = 1e-9;

const WINDOW_NAMES: Record<WorkerLimit, string> = {
	hour: "running now",
	day: "today",
	month: "this month",
};

function tierOf(spent: number, limit: number): AlertTier {
	if (spent <= 0) {
		return 0;
	}
	const percent = limit <= 0 ? 100 : (spent / limit) * 100 + EPSILON;
	return ([...ALERT_TIERS].reverse().find((tier) => percent >= tier) ??
		0) as AlertTier;
}

function checkDollars(amount: number): void {
	if (!(Number.isFinite(amount) && amount >= 0)) {
		throw new Error(`expected dollars, like 5 or 0.25, got ${amount}`);
	}
}
