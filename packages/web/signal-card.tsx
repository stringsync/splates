import { makeAssistantDataUI } from "@assistant-ui/react";
import type { SignalProbe, SignalWait } from "@splates/server/signals";
import {
	CircleCheckIcon,
	CircleSlashIcon,
	type LucideIcon,
	RadioIcon,
	TimerOffIcon,
	TriangleAlertIcon,
} from "lucide-react";
import { type JSX, useContext, useEffect, useState } from "react";
import { cn } from "#web/lib/utils.ts";
import type { Tone } from "./card-shell";
import { ClockTime } from "./clock-meaning";
import { useNow } from "./hooks/use-now";
import { probeBroken, probeOn } from "./probe-checks";
import {
	IN_VIEW,
	ProbeCards,
	SignalSight,
	SignalWaits,
} from "./signal-contexts";
import { countdown, lasted, probeFor, waitOf } from "./signal-of";
import { callParts, namespaceOf } from "./signal-summary";
import { SplatesEvent } from "./splates-event";
import { ThreadBar } from "./thread-bar";

export { SignalWaits } from "./signal-contexts";

/** Renders a `data-signal` part: the one card of a wait, which follows it to its end. */
export const SignalUI = makeAssistantDataUI<{ id: string }>({
	name: "signal",
	render: ({ data }) => <SignalLine id={data.id} />,
});

/**
 * One signal wait as an event line, like the thread's other events: the
 * signal's chip between two hairlines, saying the agent waits for it, with
 * how many times it has polled and its time left. A broken check marks it failed; once it ends it
 * says how and after how long.
 */
export function SignalCard({
	wait,
	probe = null,
}: {
	wait: SignalWait;
	probe?: SignalProbe | null;
}): JSX.Element {
	const [line, setLine] = useState<HTMLElement | null>(null);
	useLineInSight(line, wait.id);
	const waiting = wait.state === "waiting";
	const now = useNow(waiting);
	const broken = waiting && probe !== null && probeBroken(probe);
	const count = waiting && probe !== null ? polls(probe) : null;
	const clock = waiting ? wait.clock : undefined;
	const detail = waiting
		? [
				count === null ? null : `${count} ${count === 1 ? "poll" : "polls"}`,
				waitCountdown(wait, now),
			]
				.filter((part) => part !== null)
				.join(" · ")
		: ended(wait);
	const named = {
		kind: "signal",
		name: wait.name,
		...(clock === undefined ? {} : { label: callParts(wait.name).fn }),
	} as const;
	return (
		// vet-ignore splates-conversation-card: wraps SplatesEvent for data-card scroll and sight tracking
		<div ref={setLine} data-card>
			<SplatesEvent
				event={{
					mark:
						broken || wait.state === "timed out"
							? "failed"
							: wait.state === "raised"
								? "landed"
								: null,
					words: broken
						? ["Check failing for", named, detail]
						: waiting
							? ["Waiting for", named, detail]
							: ["Signal", named, detail],
					secondary: <ClockFiring clock={clock} />,
					title: wait.reason,
				}}
			/>
		</div>
	);
}

/**
 * One signal wait as a bar to put above the composer, using the shared
 * `ThreadBar` with the Signals menu's `RadioIcon`: it names the signal, says
 * the agent waits for it, and shows the polls/time left inline, with a ghost
 * View CTA linking to the signal on the Signals page. `more` counts the other
 * live waits it stands in for.
 */
export function SignalBar({
	wait,
	probe = null,
	more = 0,
}: {
	wait: SignalWait;
	probe?: SignalProbe | null;
	more?: number;
}): JSX.Element {
	const waiting = wait.state === "waiting";
	const clock = waiting ? wait.clock : undefined;
	const scheduled = clock?.next != null;
	const now = useNow(waiting);
	const broken = waiting && probe !== null && probeBroken(probe);
	const { Icon, tone } = broken ? BROKEN : LOOK[wait.state];
	const { namespace, leaf } = namespaceOf(wait.name);
	const detail = scheduled ? (
		<>
			<span className="tabular-nums">{waitCountdown(wait, now)}</span>
			<ClockFiring clock={clock} />
		</>
	) : waiting ? (
		left(wait, probe, now)
	) : (
		ended(wait)
	);
	return (
		<ThreadBar
			Icon={Icon}
			iconTone={tone}
			href={`#signals/${encodeURIComponent(wait.name)}`}
			aria-label={`View signal ${wait.name}`}
			title={wait.description === "" ? undefined : wait.description}
			cta="View"
			label={
				<span className="flex min-w-0 items-baseline gap-1.5">
					<span className="shrink-0">
						{broken ? "Check failing for" : waiting ? "Waiting for" : "Signal"}
					</span>
					<span
						title={`signal ${wait.name}`}
						className="flex min-w-0 items-baseline font-mono"
					>
						{namespace !== leaf && (
							<span className="min-w-0 truncate text-muted-foreground">
								{namespace}.
							</span>
						)}
						<span className="shrink-0">{leaf}</span>
					</span>
					{more > 0 && (
						<span className="shrink-0 text-muted-foreground text-xs">
							+{more}
						</span>
					)}
					<span
						title={wait.reason}
						className={cn(
							"shrink-0 truncate text-xs tabular-nums",
							broken ? "text-warning" : "text-muted-foreground",
						)}
					>
						· {detail}
					</span>
				</span>
			}
		/>
	);
}

/** The exact firing time is secondary to the countdown in both wait views. */
function ClockFiring({ clock }: { clock: SignalWait["clock"] }) {
	if (clock?.next == null) {
		return null;
	}
	return (
		<span className="hidden @min-[32rem]:inline">
			{" "}
			· Fires <ClockTime at={clock.next} zone={clock.tz} />
		</span>
	);
}

/** Count down to the firing, or to the wait's timeout if it comes first. */
function waitCountdown(wait: SignalWait, now: number): string {
	const next = wait.clock?.next;
	if (next == null) {
		return `${countdown(wait.deadline, now)} left`;
	}
	return wait.deadline !== "" && Date.parse(wait.deadline) < Date.parse(next)
		? `${countdown(wait.deadline, now)} until timeout`
		: `${countdown(next, now)} left`;
}

/** The blue dot, pulsing, that leads a bar or card header while a wait runs. */
export function PulsingDot({ className }: { className?: string }): JSX.Element {
	return (
		<span
			aria-hidden
			className={cn(
				"flex size-4 shrink-0 items-center justify-center",
				className,
			)}
		>
			<span className="size-2.5 animate-pulse rounded-full bg-info ring-4 ring-info/25 motion-reduce:animate-none" />
		</span>
	);
}

/** Tells the thread's `SignalSight` whether `line`, a wait's line, shows enough of itself to stand in for the bar. */
function useLineInSight(line: HTMLElement | null, id: string): void {
	const sight = useContext(SignalSight)?.sight;
	useEffect(() => {
		if (line === null || sight === undefined) {
			return;
		}
		const observer = new IntersectionObserver(
			(entries) => {
				const latest = entries.at(-1);
				if (latest !== undefined) {
					sight(id, latest.intersectionRatio >= IN_VIEW);
				}
			},
			{ threshold: IN_VIEW },
		);
		observer.observe(line);
		return () => {
			observer.disconnect();
			sight(id, false);
		};
	}, [line, id, sight]);
}

const LOOK: Record<SignalWait["state"], { Icon: LucideIcon; tone: Tone }> = {
	waiting: { Icon: RadioIcon, tone: "info" },
	raised: { Icon: CircleCheckIcon, tone: "success" },
	"timed out": { Icon: TimerOffIcon, tone: "warning" },
	stopped: { Icon: CircleSlashIcon, tone: "neutral" },
	removed: { Icon: CircleSlashIcon, tone: "neutral" },
};

const BROKEN: { Icon: LucideIcon; tone: Tone } = {
	Icon: TriangleAlertIcon,
	tone: "warning",
};

/** What a waiting wait has left: its probe's polls so far, when one checks for it, and its time. */
function left(
	wait: SignalWait,
	probe: SignalProbe | null,
	now: number,
): string {
	if (wait.deadline === "") {
		return "no deadline";
	}
	const time = `${countdown(wait.deadline, now)} left`;
	const count = probe === null ? null : polls(probe);
	return count === null
		? time
		: `${count} ${count === 1 ? "poll" : "polls"} · ${time}`;
}

/** How many times a probe has polled so far; null once it has stopped. */
export function polls(probe: SignalProbe): number | null {
	return probeOn(probe) ? probe.count : null;
}

/** How an ended wait ended, and after how long. */
function ended(wait: SignalWait): string {
	const end = wait.raise?.at ?? wait.endedAt ?? wait.deadline;
	const took = lasted(wait.startedAt, end);
	return wait.state === "raised"
		? `fired after ${took}`
		: wait.state === "timed out"
			? `timed out after ${took}`
			: wait.state === "removed"
				? "signal removed"
				: "stopped";
}

function SignalLine({ id }: { id: string }): JSX.Element | null {
	const { waits } = useContext(SignalWaits);
	const probes = useContext(ProbeCards);
	const wait = waits.find((each) => each.id === waitOf(id));
	if (wait === undefined) {
		return null;
	}
	return <SignalCard wait={wait} probe={probeFor(wait, probes)} />;
}
