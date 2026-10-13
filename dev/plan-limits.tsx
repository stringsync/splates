import { type JSX, useEffect, useState } from "react";
import { Duration, SystemTimer } from "webappwiz/time";
import { cn } from "#dev/lib/utils.ts";
import type { ConversationState, Limit } from "../conversations";
import type { AgentChoice } from "./conversation-feed";

/** The windows shown, in this order, by what Claude calls each. */
const WINDOWS: [string, string][] = [
	["five_hour", "5-hour"],
	["seven_day", "Weekly"],
	["seven_day_opus", "Weekly Opus"],
	["seven_day_sonnet", "Weekly Sonnet"],
];

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

/** How full a window may get before it warns, and before it alarms. */
const NEARLY_FULL = 0.8;
const ALL_BUT_FULL = 0.9;

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

/** The clock, as epoch ms, moving each minute. */
function useMinute(): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const tick = new SystemTimer().setInterval(
			() => setNow(Date.now()),
			Duration.mins(1),
		);
		return () => tick.dispose();
	}, []);
	return now;
}

/**
 * How much of the plan's windows is used and when each starts over, beside
 * Pick back up: yellow from 80% used, red from 90%. Nothing until the agent
 * has said, which only Claude does.
 */
export function PlanLimits({
	limits,
}: {
	limits: Limit[];
}): JSX.Element | null {
	const now = useMinute();
	if (limits.length === 0) {
		return null;
	}
	return (
		<section aria-label="plan limits" className="mt-4 flex flex-col gap-1 px-2">
			<h3 className="pl-3 font-medium text-muted-foreground text-xs">
				Plan limits
			</h3>
			<ul className="flex flex-col">
				{limits.map((limit) => {
					const resets = Date.parse(limit.resets);
					// Past its reset, it has started over since the agent said.
					const over = resets <= now;
					const used = over ? 0 : Math.min(Math.max(limit.used, 0), 1);
					const tone =
						used >= ALL_BUT_FULL
							? "destructive"
							: used >= NEARLY_FULL
								? "warning"
								: null;
					const name = nameOf(limit.window);
					return (
						<li
							key={limit.window}
							aria-label={name}
							className="grid grid-cols-[6rem_1fr_3rem_14rem] items-center gap-3 rounded-md px-3 py-1.5 text-sm tabular-nums"
						>
							<span>{name}</span>
							<span
								aria-hidden
								className="relative h-1 overflow-hidden rounded-full bg-foreground/15"
							>
								<span
									className={cn(
										"absolute inset-y-0 left-0 rounded-full bg-foreground",
										tone === "warning" && "bg-warning",
										tone === "destructive" && "bg-destructive",
									)}
									style={{ width: `${used * 100}%` }}
								/>
							</span>
							<span
								className={cn(
									"text-right",
									tone === "warning" && "text-warning",
									tone === "destructive" && "text-destructive",
								)}
							>
								{Math.round(used * 100)}%
							</span>
							<span className="text-muted-foreground text-xs">
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
