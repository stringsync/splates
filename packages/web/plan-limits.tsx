import type { ConversationState, Limit } from "@splates/server/conversations";
import {
	antigravityGroups,
	antigravityLimitsForModel,
	currentAntigravityLimits,
} from "@splates/server/models/browser";
import { GaugeIcon } from "lucide-react";
import type { JSX } from "react";
import {
	Popover,
	PopoverContent,
	PopoverTitle,
	PopoverTrigger,
} from "#web/components/ui/popover.tsx";
import { cn } from "#web/lib/utils.ts";
import { AgentMark } from "./agent-icons";
import type { AgentChoice } from "./conversation-feed";
import { useMinute } from "./hooks/use-minute";
import { METER_COLUMNS, Meter, toneOf } from "./meter";

/** The windows shown, in this order, by what Claude calls each. */
const WINDOWS: [string, string][] = [
	["five_hour", "5-hour"],
	["seven_day", "Weekly"],
	["seven_day_opus", "Weekly Opus"],
	["seven_day_sonnet", "Weekly Sonnet"],
	["month", "Monthly"],
];

/**
 * Windows Claude reports that claude.ai's usage settings leave out, so they
 * stay out here too.
 */
const UNSHOWN = new Set(["seven_day_overage_included"]);

const QUOTA_COLUMNS =
	"grid-cols-[max-content_1fr_3rem_14rem] max-md:grid-cols-[max-content_1fr_3rem]";

export function AgentQuotas({
	agents,
	conversations,
}: {
	agents: AgentChoice[];
	conversations: ConversationState[];
}): JSX.Element | null {
	const groups = quotaByAgent(agents, conversations);
	if (groups.length === 0) {
		return null;
	}
	return (
		<div className="@container/quotas">
			<div
				className={cn(
					"grid grid-cols-[max-content_1fr_3rem_5rem] gap-x-3 gap-y-4",
					"@min-[40rem]/quotas:grid-cols-[max-content_1fr_3rem_14rem]",
					"max-md:grid-cols-[max-content_1fr_3rem]",
				)}
			>
				{groups.map((group) => (
					<PlanLimits key={group.title} {...group} sharedColumns />
				))}
			</div>
		</div>
	);
}

/**
 * How much of the plan's windows is used and when each starts over, beside
 * Pick back up: yellow from 80% used, red from 90%. Shows nothing for an
 * empty `limits`.
 */
export function PlanLimits({
	limits,
	title = "Plan limits",
	className,
	aligned = false,
	paced = false,
	sharedColumns = false,
	marks,
}: {
	limits: Limit[];
	/** The agent whose mark leads each limit's name, by index; none when omitted. */
	marks?: string[];
	className?: string;
	/**
	 * Puts each window's burn rate before its reset time, and beside the
	 * title a pace icon when a window will run out before it resets.
	 */
	paced?: boolean;
	/**
	 * Lays the rows out in `METER_COLUMNS`, each reset under its bar, so the
	 * bars line up with the page's other meters. On mobile the numbers sit
	 * above a full-width bar, with the reset time beneath it.
	 */
	aligned?: boolean;
	/** Inherits the columns shared by the quota groups in AgentQuotas. */
	sharedColumns?: boolean;
	/** What the list is headed, like the agent whose plan it is. */
	title?: string;
}): JSX.Element | null {
	const now = useMinute();
	if (limits.length === 0) {
		return null;
	}
	return (
		<section
			aria-label={
				title === "Plan limits" ? "plan limits" : `${title} plan limits`
			}
			className={cn(
				"mt-4 gap-y-1 px-2",
				sharedColumns
					? "col-span-full grid grid-cols-subgrid"
					: "flex flex-col",
				className,
			)}
		>
			<h3 className="col-span-full flex items-center gap-1 pl-3 font-medium text-muted-foreground text-xs">
				{title}
				{paced && <QuotaWarning limits={limits} now={now} />}
			</h3>
			{/* Budget meters get their own full-width row on mobile. */}
			<ul
				className={cn(
					"grid gap-x-3",
					sharedColumns
						? "col-span-full grid-cols-subgrid"
						: aligned
							? cn(METER_COLUMNS, "max-md:gap-y-2")
							: paced
								? "grid-cols-[max-content_1fr_3rem_17rem] max-md:grid-cols-[max-content_1fr_3rem]"
								: QUOTA_COLUMNS,
				)}
			>
				{limits.map((limit, index) => {
					const mark = marks?.[index];
					const { name, used, tone, reset, countdown, pace } = limitRow(
						limit,
						now,
					);
					return (
						<li
							key={limit.window}
							aria-label={name}
							className={cn(
								"col-span-full grid grid-cols-subgrid items-center rounded-md py-1.5 text-sm tabular-nums",
								aligned ? "max-md:gap-y-2" : "px-3",
							)}
						>
							<span
								className={cn(
									aligned ? "min-w-0 break-words" : "whitespace-nowrap",
									mark !== undefined && "flex items-center gap-1.5",
								)}
							>
								{mark !== undefined && (
									<AgentMark agent={mark} className="size-4 shrink-0" />
								)}
								{name}
							</span>
							<Meter
								used={used}
								className={
									aligned
										? "max-md:col-span-full max-md:row-start-2"
										: undefined
								}
							/>
							<span
								className={cn(
									"text-right",
									aligned && "max-md:col-start-2 max-md:row-start-1",
									tone === "warning" && "text-warning",
									tone === "destructive" && "text-destructive",
								)}
							>
								{Math.round(used * 100)}%
							</span>
							<span
								title={sharedColumns ? reset : undefined}
								className={cn(
									"text-muted-foreground text-xs",
									sharedColumns && "whitespace-nowrap",
									aligned
										? "col-span-2 col-start-2 max-md:col-span-full max-md:col-start-1"
										: "max-md:col-span-full",
								)}
							>
								{sharedColumns ? (
									<>
										<span className="@min-[40rem]/quotas:hidden">
											{countdown}
										</span>
										<span className="hidden @min-[40rem]/quotas:inline">
											{reset}
										</span>
									</>
								) : paced ? (
									pacedReset({ pace, reset })
								) : (
									reset
								)}
							</span>
						</li>
					);
				})}
			</ul>
		</section>
	);
}

/**
 * What `agent` last said of each window of the plan: the newest of what it
 * said in any project and in each of `conversations` here.
 */
export function limitsOf(
	agents: AgentChoice[],
	conversations: ConversationState[],
	agent: string,
): Limit[] {
	const said = [
		...(agents.find((each) => each.id === agent)?.limits ?? []),
		...conversations
			.filter((each) => each.agent === agent)
			.flatMap((each) => each.usage.limits),
	];
	const windows = [
		...WINDOWS.map(([window]) => window),
		...new Set(said.map((each) => each.window)),
	];
	return [...new Set(windows)].flatMap((window) => {
		if (UNSHOWN.has(window)) {
			return [];
		}
		const newest = said
			.filter((each) => each.window === window)
			.reduce<Limit | null>(
				(best, each) =>
					best === null || (each.at ?? "") > (best.at ?? "") ? each : best,
				null,
			);
		return newest === null ? [] : [newest];
	});
}

/** Returns each provider's shortest reported quota for display, grouped by reset schedule. */
export function quotaByAgent(
	agents: AgentChoice[],
	conversations: ConversationState[],
): { title: string; limits: Limit[]; marks: string[] }[] {
	const groups = new Map<number, { limits: Limit[]; marks: string[] }>();
	const addRow = (agentId: string, label: string, limits: Limit[]): void => {
		const known = limits.flatMap((each) => {
			const length = lengthOf(each.window);
			return length === null ? [] : [{ each, length }];
		});
		if (known.length === 0) {
			return;
		}
		const shortest = Math.min(...known.map((one) => one.length));
		const fullest = known
			.filter((one) => one.length === shortest)
			.reduce((best, one) => (one.each.used > best.each.used ? one : best));
		const group = groups.get(shortest) ?? { limits: [], marks: [] };
		groups.set(shortest, {
			limits: [...group.limits, { ...fullest.each, window: label }],
			marks: [...group.marks, agentId],
		});
	};
	for (const agent of agents) {
		const raw = limitsOf(agents, conversations, agent.id);
		if (agent.id === "antigravity") {
			const grouped = antigravityGroups(raw);
			if (grouped.length > 0) {
				for (const each of grouped) {
					addRow(agent.id, `${agent.name} · ${each.label}`, each.limits);
				}
				continue;
			}
		}
		addRow(agent.id, agent.name, raw);
	}
	return [...groups.entries()]
		.sort(([one], [other]) => one - other)
		.map(([length, { limits, marks }]) => ({
			title: `${scheduleName(length)} quota`,
			limits,
			marks,
		}));
}

/** What a window length is called: `5-hour`, `Weekly`, `30-day`. */
function scheduleName(length: number): string {
	if (length === 7 * DAY_MS) {
		return "Weekly";
	}
	return length % DAY_MS === 0
		? `${length / DAY_MS}-day`
		: length % HOUR === 0
			? `${length / HOUR}-hour`
			: `${Math.round(length / 60_000)}-minute`;
}

/** When the newest of `limits` was said, as epoch ms; null when none says. */
export function saidAt(limits: Limit[]): number | null {
	const times = limits.flatMap((each) =>
		each.at == null ? [] : [Date.parse(each.at)],
	);
	return times.length === 0 ? null : Math.max(...times);
}

/** How long ago `at` was: `just now`, `4m ago`, `2h ago`, `3d ago`. */
export function ago(at: number, now: number): string {
	const minutes = Math.max(0, Math.floor((now - at) / 60_000));
	if (minutes < 1) {
		return "just now";
	}
	return minutes < 60
		? `${minutes}m ago`
		: minutes < 1440
			? `${Math.floor(minutes / 60)}h ago`
			: `${Math.floor(minutes / 1440)}d ago`;
}

/**
 * What a window is called: its name when Claude has one for it, else its
 * length, as Codex's `43200_minutes` is `30-day`.
 */
function nameOf(window: string): string {
	const named = WINDOWS.find(([each]) => each === window)?.[1];
	if (named !== undefined) {
		return named;
	}
	const minutes = Number(/^(\d+)_minutes$/.exec(window)?.[1]);
	if (!Number.isFinite(minutes) || minutes <= 0) {
		return window.replace(/ · Five Hour$/, " · 5-hour");
	}
	return minutes % 1440 === 0
		? `${minutes / 1440}-day`
		: minutes % 60 === 0
			? `${minutes / 60}-hour`
			: `${minutes}-minute`;
}

const CLOCK = new Intl.DateTimeFormat("en", {
	hour: "numeric",
	minute: "2-digit",
});
const DAY = new Intl.DateTimeFormat("en", {
	weekday: "short",
	hour: "numeric",
	minute: "2-digit",
});

const DATE = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });

/**
 * When a window resets: the time within a day, the day and time within a
 * week, else the date.
 */
function clock(at: number, now: number): string {
	const day = 24 * 3_600_000;
	return at - now < day
		? CLOCK.format(at)
		: at - now < 6 * day
			? DAY.format(at)
			: DATE.format(at);
}

/** How long until `at`: `2h 13m`, `2d 19h`. */
function until(at: number, now: number): string {
	const minutes = Math.max(0, Math.ceil((at - now) / 60_000));
	const hours = Math.floor(minutes / 60);
	if (hours >= 24) {
		return `${Math.floor(hours / 24)}d ${hours % 24}h`;
	}
	return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

const HOUR = 3_600_000;
const DAY_MS = 24 * HOUR;

/** How long a window runs from start to reset, in ms; null when unknown. */
export function lengthOf(window: string): number | null {
	if (window === "five_hour" || / · Five Hour$/i.test(window)) {
		return 5 * HOUR;
	}
	if (window.startsWith("seven_day") || / · Weekly$/i.test(window)) {
		return 7 * DAY_MS;
	}
	if (window === "month") {
		return 30 * DAY_MS;
	}
	const minutes = Number(/^(\d+)_minutes$/.exec(window)?.[1]);
	return Number.isFinite(minutes) && minutes > 0 ? minutes * 60_000 : null;
}

/**
 * The share of a window's run that must pass before its burn rate shows, so
 * a heavy first hour does not read as a week's pace.
 */
const SETTLED = 0.1;

/**
 * How fast `limit` is being used, as its average since the window began, and
 * when it runs out at that pace if that comes before it resets. Null for a
 * window of unknown length, past its reset, or in its first tenth.
 */
export function paceOf(
	limit: Limit,
	now: number,
): { perHour: number; label: string; runsOut: number | null } | null {
	const length = lengthOf(limit.window);
	const resets = limit.resets === null ? null : Date.parse(limit.resets);
	if (length === null || resets === null || resets <= now) {
		return null;
	}
	const said = limit.at === null ? now : Date.parse(limit.at);
	const elapsed = said - (resets - length);
	if (!Number.isFinite(elapsed) || elapsed < length * SETTLED) {
		return null;
	}
	const used = Math.min(Math.max(limit.used, 0), 1);
	const perHour = (used / elapsed) * HOUR;
	const out =
		used >= 1 || perHour <= 0 ? null : said + ((1 - used) / perHour) * HOUR;
	return {
		perHour,
		label:
			length < DAY_MS
				? `${percent(perHour)}/h`
				: `${percent(perHour * 24)}/day`,
		runsOut: out !== null && out < resets ? out : null,
	};
}

/** A rate as a whole percent, `<1%` below one. */
function percent(share: number): string {
	const whole = Math.round(share * 100);
	return whole < 1 ? "<1%" : `${whole}%`;
}

/** A row's reset line with its burn rate before it, when it has one. */
export function pacedReset({
	pace,
	reset,
}: {
	pace: string;
	reset: string;
}): string {
	return pace === "" || reset === "" ? reset : `${pace} · ${reset}`;
}

/**
 * The window of `limits` that runs out first at its current pace, of those
 * that run out before they reset, with when it runs out and resets; null
 * when none does.
 */
export function firstRunOut(
	limits: Limit[],
	now: number,
): { limit: Limit; out: number; resets: number } | null {
	const all = limits.flatMap((limit) => {
		const out = paceOf(limit, now)?.runsOut;
		return out == null || limit.resets === null
			? []
			: [{ limit, out, resets: Date.parse(limit.resets) }];
	});
	return all.sort((one, other) => one.out - other.out)[0] ?? null;
}

/**
 * A quiet gauge icon, shown when a window of `limits` runs out before it
 * resets at its current pace, that opens a popover naming the first to run
 * out, its pace, and when it runs out and resets; nothing otherwise.
 */
export function QuotaWarning({
	limits,
	now,
	className,
}: {
	limits: Limit[];
	now: number;
	className?: string;
}): JSX.Element | null {
	const first = firstRunOut(limits, now);
	if (first === null) {
		return null;
	}
	const name = nameOf(first.limit.window);
	const pace = paceOf(first.limit, now)?.label;
	return (
		<Popover>
			<PopoverTrigger
				aria-label="quota pace"
				className={cn(
					"inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground data-popup-open:bg-muted",
					className,
				)}
			>
				<GaugeIcon aria-hidden className="size-3.5" />
			</PopoverTrigger>
			<PopoverContent align="end" className="w-64 gap-1 text-xs">
				<PopoverTitle className="flex items-center gap-1.5 text-xs">
					<GaugeIcon aria-hidden className="size-3.5 text-muted-foreground" />
					{name} is running ahead
				</PopoverTitle>
				<p className="leading-snug">
					{pace === undefined ? "" : `At ${pace}, `}
					{name} runs out ~{clock(first.out, now)}, before its{" "}
					{clock(first.resets, now)} reset.
				</p>
				<p className="text-muted-foreground">
					Pace is the average since the window began.
				</p>
			</PopoverContent>
		</Popover>
	);
}

/** A limit's display name, share used (0 once past reset), tone, burn rate and reset line. */
export function limitRow(
	limit: Limit,
	now: number,
): {
	name: string;
	used: number;
	tone: "warning" | "destructive" | null;
	/** The burn rate, `25%/h` or `12%/day`; empty when it does not show. */
	pace: string;
	reset: string;
	countdown: string;
} {
	const resets = limit.resets === null ? null : Date.parse(limit.resets);
	// Past its reset, it has started over since the agent said.
	const over = resets !== null && resets <= now;
	const used = over ? 0 : Math.min(Math.max(limit.used, 0), 1);
	const remaining = resets === null || over ? "" : `in ${until(resets, now)}`;
	return {
		name: nameOf(limit.window),
		used,
		tone: toneOf(used),
		pace: paceOf(limit, now)?.label ?? "",
		countdown: over ? "reset" : remaining,
		reset:
			resets === null
				? ""
				: over
					? `reset ${clock(resets, now)}`
					: `resets ${clock(resets, now)}, ${remaining}`,
	};
}

/** Collapses legacy Enterprise per-model buckets into one row at the highest usage. */
function collapsedAntigravity(limits: Limit[]): Limit[] {
	const most = limits.reduce<Limit | null>(
		(best, limit) => (best === null || limit.used > best.used ? limit : best),
		null,
	);
	return most === null
		? []
		: [
				{
					...most,
					window: "Antigravity quota",
				},
			];
}

/** Antigravity's plan windows for Billing. */
export function antigravityPlanLimits(limits: Limit[]): Limit[] {
	const current = currentAntigravityLimits(limits);
	return current.kind === "grouped"
		? current.limits
		: collapsedAntigravity(current.limits);
}

/** Antigravity's plan windows for `model` on the new-conversation screen and conversation widget. */
export function antigravityModelLimits(
	limits: Limit[],
	model: string,
): Limit[] {
	const current = currentAntigravityLimits(limits);
	const matched = antigravityLimitsForModel(limits, model);
	return current.kind === "grouped" ? matched : collapsedAntigravity(matched);
}
