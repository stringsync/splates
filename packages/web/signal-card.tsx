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
import { buttonVariants } from "#web/components/ui/button.tsx";
import { cn } from "#web/lib/utils.ts";
import { useNow } from "./hooks/use-now";
import { probeBroken, probeOn } from "./probe-checks";
import {
	IN_VIEW,
	ProbeCards,
	SignalSight,
	SignalWaits,
} from "./signal-contexts";
import { countdown, lasted, probeFor, waitOf } from "./signal-of";
import { namespaceOf } from "./signal-summary";
import { SplatesEvent } from "./splates-event";

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
	const detail = waiting
		? [
				count === null ? null : `${count} ${count === 1 ? "poll" : "polls"}`,
				`${countdown(wait.deadline, now)} left`,
			]
				.filter((part) => part !== null)
				.join(" · ")
		: ended(wait);
	const named = { kind: "signal", name: wait.name } as const;
	return (
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
					title: wait.reason,
				}}
			/>
		</div>
	);
}

/**
 * One signal wait as a bar to put above the composer, in the look of the
 * thread's other bars: it names the signal, says the agent waits for it, and
 * counts the polls so far and the time left, ending in a View button to the signal on the Signals
 * page. `more` counts the other live waits it stands in for.
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
	const now = useNow(waiting);
	const broken = waiting && probe !== null && probeBroken(probe);
	const { Icon, tone } = broken ? BROKEN : LOOK[wait.state];
	const { namespace, leaf } = namespaceOf(wait.name);
	return (
		<section
			data-card
			title={wait.description === "" ? undefined : wait.description}
			className="@container relative flex items-center gap-3 overflow-hidden rounded-lg border bg-card px-4 py-2.5 text-sm shadow-xs"
		>
			{waiting && !broken ? (
				<PulsingDot />
			) : (
				<Icon className={cn("size-4 shrink-0", tone)} />
			)}
			<span className="flex min-w-0 flex-1 items-baseline gap-1.5">
				<span className="shrink-0">
					{broken ? "Check failing for" : waiting ? "Waiting for" : "Signal"}
				</span>
				<span
					title={`signal ${wait.name}`}
					className="flex min-w-0 items-baseline font-mono text-sm"
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
			</span>
			<span
				className={cn(
					"hidden shrink-0 text-xs tabular-nums @min-[32rem]:block",
					broken ? "text-warning" : "text-muted-foreground",
				)}
				title={wait.reason}
			>
				{waiting ? left(wait, probe, now) : ended(wait)}
			</span>
			<a
				href={`#signals/${encodeURIComponent(wait.name)}`}
				aria-label={`View signal ${wait.name}`}
				className={cn(
					buttonVariants({ size: "sm", variant: "outline" }),
					"bg-background",
				)}
			>
				View
			</a>
		</section>
	);
}

/** The blue dot, pulsing, that leads a bar while its wait runs. */
export function PulsingDot(): JSX.Element {
	return (
		<span
			aria-hidden
			className="mx-[3px] size-2.5 shrink-0 animate-pulse rounded-full bg-info ring-4 ring-info/25 motion-reduce:animate-none"
		/>
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

const LOOK: Record<SignalWait["state"], { Icon: LucideIcon; tone: string }> = {
	waiting: { Icon: RadioIcon, tone: "text-info" },
	raised: { Icon: CircleCheckIcon, tone: "text-success" },
	"timed out": { Icon: TimerOffIcon, tone: "text-warning" },
	stopped: { Icon: CircleSlashIcon, tone: "text-muted-foreground" },
	removed: { Icon: CircleSlashIcon, tone: "text-muted-foreground" },
};

const BROKEN = { Icon: TriangleAlertIcon, tone: "text-warning" };

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
