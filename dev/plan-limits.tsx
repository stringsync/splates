import type { JSX } from "react";
import { cn } from "#dev/lib/utils.ts";
import type { ConversationState, Limit } from "../conversations";
import type { AgentChoice } from "./conversation-feed";
import { useMinute } from "./hooks/use-minute";
import { METER_COLUMNS, Meter, toneOf } from "./meter";

/** The windows shown, in this order, by what Claude calls each. */
const WINDOWS: [string, string][] = [
	["five_hour", "5-hour"],
	["seven_day", "Weekly"],
	["seven_day_opus", "Weekly Opus"],
	["seven_day_sonnet", "Weekly Sonnet"],
];

/**
 * Windows Claude reports that claude.ai's usage settings leave out, so they
 * stay out here too.
 */
const UNSHOWN = new Set(["seven_day_overage_included"]);

/**
 * How much of the plan's windows is used and when each starts over, beside
 * Pick back up: yellow from 80% used, red from 90%. Nothing until the agent
 * has said, which only Claude does.
 */
export function PlanLimits({
	limits,
	title = "Plan limits",
	className,
	aligned = false,
}: {
	limits: Limit[];
	className?: string;
	/**
	 * Lays the rows out in `METER_COLUMNS`, each reset under its bar, so the
	 * bars line up with the page's other meters.
	 */
	aligned?: boolean;
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
			className={cn("mt-4 flex flex-col gap-1 px-2", className)}
		>
			<h3 className="pl-3 font-medium text-muted-foreground text-xs">
				{title}
			</h3>
			{/* On a phone, when each window resets goes under it, so its bar keeps its width. */}
			<ul
				className={cn(
					"grid gap-x-3",
					aligned
						? METER_COLUMNS
						: "grid-cols-[max-content_1fr_3rem_14rem] max-md:grid-cols-[max-content_1fr_3rem]",
				)}
			>
				{limits.map((limit) => {
					const resets = Date.parse(limit.resets);
					// Past its reset, it has started over since the agent said.
					const over = resets <= now;
					const used = over ? 0 : Math.min(Math.max(limit.used, 0), 1);
					const tone = toneOf(used);
					const name = nameOf(limit.window);
					return (
						<li
							key={limit.window}
							aria-label={name}
							className={cn(
								"col-span-full grid grid-cols-subgrid items-center rounded-md py-1.5 text-sm tabular-nums",
								!aligned && "px-3",
							)}
						>
							<span className="whitespace-nowrap">{name}</span>
							<Meter used={used} />
							<span
								className={cn(
									"text-right",
									tone === "warning" && "text-warning",
									tone === "destructive" && "text-destructive",
								)}
							>
								{Math.round(used * 100)}%
							</span>
							<span
								className={cn(
									"text-muted-foreground text-xs",
									aligned ? "col-span-2 col-start-2" : "max-md:col-span-full",
								)}
							>
								{over
									? `reset ${clock(resets, now)}`
									: `resets ${clock(resets, now)}, in ${until(resets, now)}`}
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
		return window;
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
