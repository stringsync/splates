import type { Fs } from "webappwiz/system";
import { Duration, SystemWallClock, type WallClock } from "webappwiz/time";
import { z } from "zod";
import type { BudgetReason, HeldSlot } from "./scheduler";
import { type SpendShare, splitSpend } from "./spend";

/** The limits a worker budget holds made workers to, each in US dollars. */
export const WORKER_LIMITS = ["hour", "day", "month"] as const;

/**
 * `hour` is a rate cap, the dollars per hour the made workers running at
 * once may cost together; `day` and `month` are what they may cost in all
 * since the day or month began, in local time.
 */
export type WorkerLimit = (typeof WORKER_LIMITS)[number];

/** What each limit is until the user sets it. */
export const DEFAULT_WORKER_LIMITS: Readonly<Record<WorkerLimit, number>> = {
	hour: 0.25,
	day: 5,
	month: 75,
};

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
 * figure is an estimate. Kept at `path`, so a restart forgets none of it.
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
		private readonly path: string | null,
		private readonly fs: Fs | null,
		private readonly wall: WallClock,
		private kept: KeptFile,
	) {}

	/** Reads what `path` keeps, or starts at the defaults when it keeps nothing readable. */
	static async open(
		path: string,
		fs: Fs,
		wall: WallClock = new SystemWallClock(),
	): Promise<WorkerBudget> {
		const read = await fs.read(path).catch(() => null);
		let kept = Kept.parse({});
		if (read !== null) {
			try {
				kept = Kept.parse(JSON.parse(read));
			} catch {
				// Unreadable: the defaults hold, and no spend is known.
			}
		}
		return new WorkerBudget(path, fs, wall, kept);
	}

	/** A budget kept in memory alone. */
	static memory(wall: WallClock = new SystemWallClock()): WorkerBudget {
		return new WorkerBudget(null, null, wall, Kept.parse({}));
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

	/** What made workers running now cost an hour together. */
	rate(): number {
		return this.kept.lives
			.filter((life) => life.until === null)
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

	/** Counts worker `id` as costing `dollarsPerHour` from now on. */
	async started(
		id: string,
		type: string,
		dollarsPerHour: number,
	): Promise<void> {
		const from = this.wall.now();
		await this.change((kept) => ({
			...kept,
			lives: [
				...this.recent(kept).filter(
					(life) => !(life.id === id && life.until === null),
				),
				{ id, type, dollarsPerHour, from, until: null },
			],
		}));
	}

	/** Stops counting worker `id`, destroyed now; silent for one not counted. */
	async ended(id: string): Promise<void> {
		const until = this.wall.now();
		if (
			!this.kept.lives.some((life) => life.id === id && life.until === null)
		) {
			return;
		}
		await this.change((kept) => ({
			...kept,
			lives: kept.lives.map((life) =>
				life.id === id && life.until === null ? { ...life, until } : life,
			),
			runs: kept.runs.map((run) =>
				run.worker === id && run.until === null ? { ...run, until } : run,
			),
		}));
	}

	/**
	 * Squares the runs with the slots `held` now: each held on a made worker
	 * running is counted from now, and each no longer held ends now, so
	 * spend can be split by who ran on each worker. Writes nothing when
	 * nothing changed.
	 */
	async ran(held: readonly HeldSlot[]): Promise<void> {
		const now = this.wall.now();
		const made = new Set(
			this.kept.lives
				.filter((life) => life.until === null)
				.map((life) => life.id),
		);
		const holding = held.filter((slot) => made.has(slot.worker));
		const open = this.kept.runs.filter((run) => run.until === null);
		const same = (run: Run, slot: HeldSlot): boolean =>
			run.conversation === slot.id && run.worker === slot.worker;
		const starting = holding.filter(
			(slot) => !open.some((run) => same(run, slot)),
		);
		const ending = open.filter(
			(run) => !holding.some((slot) => same(run, slot)),
		);
		if (starting.length === 0 && ending.length === 0) {
			return;
		}
		await this.change((kept) => ({
			...kept,
			runs: [
				...this.recentRuns(kept).map((run) =>
					ending.includes(run) ? { ...run, until: now } : run,
				),
				...starting.map((slot) => ({
					conversation: slot.id,
					project: slot.project,
					task: slot.task,
					worker: slot.worker,
					from: now,
					until: null,
				})),
			],
		}));
	}

	/**
	 * Who made workers' cost in `limit`'s window went to, by project and
	 * task, the most first; for the rate cap, the hour so far.
	 */
	split(limit: WorkerLimit): SpendShare[] {
		const now = this.wall.now();
		return splitSpend(
			this.kept.lives,
			this.kept.runs,
			windowStart(limit, now),
			now,
		);
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

	/** The runs still counted in some window: holding a slot, or ended this month. */
	private recentRuns(kept: KeptFile): Run[] {
		const month = windowStart("month", this.wall.now());
		return kept.runs.filter((run) => run.until === null || run.until > month);
	}

	/** The lives still counted in some window: running, or ended this month. */
	private recent(kept: KeptFile): Life[] {
		const month = windowStart("month", this.wall.now());
		return kept.lives.filter(
			(life) => life.until === null || life.until > month,
		);
	}

	private async change(next: (kept: KeptFile) => KeptFile): Promise<void> {
		this.kept = next(this.kept);
		const path = this.path;
		const fs = this.fs;
		if (path === null || fs === null) {
			return;
		}
		const text = `${JSON.stringify(this.kept, null, "\t")}\n`;
		this.writing = this.writing.then(() => fs.write(path, text));
		await this.writing;
	}
}

const Life = z.object({
	/** The worker's id. */
	id: z.string(),
	type: z.string(),
	/** Its provider's list price, which every figure here is an estimate from. */
	dollarsPerHour: z.number(),
	/** When it was made, epoch ms. */
	from: z.number(),
	/** When it was destroyed, epoch ms; null while it runs. */
	until: z.number().nullable(),
});

type Life = z.infer<typeof Life>;

const Held = z.object({
	/** The root of the project it is in. */
	project: z.string(),
	conversation: z.string(),
});

/** A conversation a hard stop checkpointed, to carry on once the budget allows. */
export type BudgetHeld = z.infer<typeof Held>;

const Run = z.object({
	/** The conversation whose agent held the slot. */
	conversation: z.string(),
	/** Its project's main tree. */
	project: z.string(),
	task: z.string().nullable(),
	/** The made worker it held a slot on. */
	worker: z.string(),
	/** When it took the slot, epoch ms. */
	from: z.number(),
	/** When it gave the slot up, epoch ms; null while it holds it. */
	until: z.number().nullable(),
});

type Run = z.infer<typeof Run>;

const Raise = z.object({
	id: z.number().int(),
	limit: z.enum(WORKER_LIMITS),
	dollars: z.number(),
	from: z.number(),
	until: z.number(),
});

/** Dollars added to one limit for a while. */
export type WorkerRaise = z.infer<typeof Raise>;

const Kept = z.object({
	/** Whether the user has chosen the limits, rather than left the defaults unseen. */
	reviewed: z.boolean().default(false),
	/** The limits set over the defaults. */
	limits: z
		.object({
			hour: z.number().optional(),
			day: z.number().optional(),
			month: z.number().optional(),
		})
		.default({}),
	raises: z.array(Raise).default([]),
	/** Each made worker's life, the ledger spend is counted from. */
	lives: z.array(Life).default([]),
	/** The conversations a hard stop checkpointed, until the budget allows again. */
	held: z.array(Held).default([]),

	/** Each agent's time on a made worker, which spend is split by. */
	runs: z.array(Run).default([]),
	/** The highest tier already alerted of each limit, by the window it was in. */
	alerted: z
		.array(
			z.object({
				limit: z.enum(WORKER_LIMITS),
				since: z.number(),
				tier: z.number(),
			}),
		)
		.default([]),
});

type KeptFile = z.infer<typeof Kept>;

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

/**
 * What a push says of `alert`, like `Workers: 90% of today's $5.00`, keyed
 * by its limit and window, so a later tier replaces an earlier one.
 */
export function alertNotice(alert: WorkerAlert): {
	title: string;
	body: string;
	key: string;
} {
	const { standing, tier } = alert;
	const limit =
		standing.limit === "hour"
			? `the ${dollars(standing.dollars)}/h rate cap`
			: `${standing.window === "today" ? "today's" : "this month's"} ${dollars(standing.dollars)}`;
	const spent =
		standing.limit === "hour"
			? `Made workers cost ${dollars(standing.spent)}/h.`
			: `Made workers cost about ${dollars(standing.spent)} ${standing.window}.`;
	return {
		title:
			tier === 100
				? `Workers: ${limit} reached`
				: `Workers: ${tier}% of ${limit}`,
		body:
			tier === 100
				? `${spent} ${standing.limit === "hour" ? "No more are made" : "Made workers stop"} until it is raised: \`splates budget raise\`.`
				: spent,
		key: `worker-budget ${standing.limit} ${standing.since}`,
	};
}

/** What a queue says when `standing`'s limit holds it, like `daily limit $5.00 reached`. */
export function reached(standing: WorkerStanding): BudgetReason {
	return standing.limit === "hour"
		? `rate cap ${dollars(standing.dollars)}/h reached`
		: `${standing.limit === "day" ? "daily" : "monthly"} limit ${dollars(standing.dollars)} reached`;
}

/** `amount` as dollars, to the cent, or to a tenth of one when it has one. */
export function dollars(amount: number): string {
	const cents = amount * 100;
	return Math.abs(cents - Math.round(cents)) < 1e-6
		? `$${amount.toFixed(2)}`
		: `$${amount.toFixed(3)}`;
}

/**
 * When `limit`'s window began, in local time: the hour, the day, or the
 * month, as scry's `windowStart` counts a day and a month.
 */
export function windowStart(limit: WorkerLimit, now: number): number {
	const date = new Date(now);
	if (limit === "hour") {
		date.setMinutes(0, 0, 0);
		return date.getTime();
	}
	date.setHours(0, 0, 0, 0);
	if (limit === "month") {
		date.setDate(1);
	}
	return date.getTime();
}

/** A span, like `1d`, `24h` or `2w`, as a duration, as scry's `within` reads one. */
export function span(text: string): Duration {
	const match = /^(\d+)([hdw])$/.exec(text);
	if (match === null) {
		throw new Error(
			`expected hours, days or weeks, like "24h", "7d" or "2w", got "${text}"`,
		);
	}
	const count = Number(match[1]);
	return match[2] === "h"
		? Duration.hrs(count)
		: Duration.days(match[2] === "d" ? count : count * 7);
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
