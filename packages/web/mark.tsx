import type { Ending, Need } from "@stringsync/splates-server/plans";
import {
	CircleCheckIcon,
	CirclePauseIcon,
	CircleXIcon,
	GitMergeIcon,
	HourglassIcon,
	Loader2Icon,
	type LucideIcon,
	TriangleAlertIcon,
} from "lucide-react";
import type { ComponentProps, JSX } from "react";
import { cn } from "#web/lib/utils.ts";
import { waitsOn } from "./conversation-names";
import { Dot } from "./dot";
import { placeInLine } from "./merge-place";
import { type Quiet, quietTitle } from "./quiet";

/**
 * What a list shows of an agent: a yellow triangle when it waits on you,
 * whatever for, a spinner while it or an agent it handed a task to works,
 * assuming or not, a blue dot when it answered and you have not looked since,
 * and, once work stops, over the blue dot, a green check once its task merged or it
 * reported its work done, a red cross once
 * it was removed and a yellow pause once it was deferred.
 * While its task's merge tests and lands, the spinner gives way to a blue
 * merge icon, and while the merge waits its turn, to an hourglass.
 * An idle agent with a command left running in the background shows a
 * muted spinner, over a completion report or the blue dot, saying what is running. Anything else, idle and read, shows an empty space. A report in its last word decides the mark over a wait it
 * ended, though not over a live ask or a failure, which are newer. What it
 * waits on is in its tooltip. A spinner gone quiet long enough that the agent
 * may be stuck stops, in amber, saying how long in its tooltip. Each sits centered in a box of one size, so
 * marks line up down a list whichever kind they are. A subagent shows only
 * its spinner, and its failure, which nothing else tells of: the rest of what
 * it needs reaches you through the agent it answers to.
 */
export function Mark({
	need,
	reported = null,
	unread = false,
	hosting = false,
	subagent = false,
	starting = false,
	queued = false,
	picking = false,
	quiet = null,
	background = false,
}: {
	need: Need;
	/** Its agent has yet to open a session, so no work is running. */
	starting?: boolean;
	/** Its task is queued and has not started. */
	queued?: boolean;
	/** Auto pick has yet to decide its agent, which opens once it has. */
	picking?: boolean;
	reported?: Ending | null;
	unread?: boolean;
	/** Whether an agent it handed a task to is at work. */
	hosting?: boolean;
	/** Whether it answers to another agent rather than to you. */
	subagent?: boolean;
	/** How long it has been quiet, once it may be stuck; null while it is not. */
	quiet?: Quiet | null;
	/** Whether it has left a command running in the background. */
	background?: boolean;
}): JSX.Element {
	if (need.kind === "working" && need.merge === "running") {
		return (
			<span
				role="status"
				aria-label="merging"
				title="Merging"
				className="flex size-3.5 shrink-0 items-center justify-center"
			>
				<GitMergeIcon className="size-3.5 text-muted-foreground" />
			</span>
		);
	}
	if (need.kind === "working" && need.merge === "queued") {
		return (
			<span
				role="status"
				aria-label="waiting to merge"
				title={
					need.mergePlace === undefined
						? "Waiting to merge"
						: `Waiting to merge, ${placeInLine(need.mergePlace)}`
				}
				className="flex size-3.5 shrink-0 items-center justify-center"
			>
				<HourglassIcon className="size-3.5 text-muted-foreground" />
			</span>
		);
	}
	if (starting || queued) {
		const waiting = queued
			? "Queued"
			: picking
				? "Auto pick is choosing the agent"
				: "Waiting for agent to start";
		return (
			<span
				role="status"
				aria-label={waiting.toLowerCase()}
				title={waiting}
				className="flex size-3.5 shrink-0 items-center justify-center"
			>
				<HourglassIcon className="size-3.5 text-muted-foreground" />
			</span>
		);
	}
	if (subagent && !(need.kind === "waiting" && need.why === "failed")) {
		return (
			<Mark
				need={need.kind === "waiting" ? { kind: "idle" } : need}
				hosting={hosting}
				quiet={quiet}
			/>
		);
	}
	// Over the blue dot, since the agent wakes to answer again once its
	// command ends, so the mark holds when you open the row.
	if (need.kind === "idle" && !hosting && background && !waitsOn(reported)) {
		return (
			<span
				role="status"
				aria-label="background commands running"
				title="Background commands running"
				className="flex size-3.5 shrink-0 items-center justify-center"
			>
				<Loader2Icon className="size-3.5 animate-spin text-muted-foreground" />
			</span>
		);
	}
	const shows =
		need.kind === "idle" ||
		(need.kind === "waiting" && need.why !== "ask" && need.why !== "failed");
	if ((reported === "merged" || reported === "done") && shows && !hosting) {
		return (
			<Glyph
				icon={CircleCheckIcon}
				role="img"
				aria-label={reported}
				color="text-success"
			/>
		);
	}
	if (reported === "removed" && shows && !hosting) {
		return (
			<Glyph
				icon={CircleXIcon}
				role="img"
				aria-label="removed"
				color="text-destructive"
			/>
		);
	}
	if (reported === "deferred" && shows && !hosting) {
		return (
			<Glyph
				icon={CirclePauseIcon}
				role="img"
				aria-label="deferred"
				color="text-warning"
			/>
		);
	}
	if (unread && need.kind === "idle" && !hosting && !waitsOn(reported)) {
		return <Dot role="status" aria-label="unread" color="bg-info" />;
	}
	if (need.kind === "waiting" || (waitsOn(reported) && shows)) {
		return (
			<Glyph
				icon={TriangleAlertIcon}
				role="status"
				aria-label="waiting on you"
				title={need.kind === "waiting" ? need.subject : undefined}
				color="text-warning"
			/>
		);
	}
	if (need.kind === "idle" && !hosting) {
		// Empty, so what sits beside it lines up with the rows that have one.
		return <span className="size-3.5 shrink-0" />;
	}
	if (quiet !== null && need.kind !== "idle") {
		return (
			<span
				role="status"
				aria-label="possibly stuck"
				title={quietTitle(quiet)}
				className="flex size-3.5 shrink-0 items-center justify-center"
			>
				<Loader2Icon className="size-3.5 text-warning" />
			</span>
		);
	}
	return (
		<span
			role="status"
			aria-label="working"
			className="flex size-3.5 shrink-0 items-center justify-center"
		>
			<Loader2Icon className="size-3.5 animate-spin text-foreground/60" />
		</span>
	);
}

/**
 * An icon in a mark's box, as `Dot` is a dot: `color` is its text class; the
 * rest goes on the box.
 */
function Glyph({
	icon: Icon,
	color,
	...box
}: { icon: LucideIcon; color: string } & Omit<
	ComponentProps<"span">,
	"className"
>): JSX.Element {
	return (
		<span
			{...box}
			className="flex size-3.5 shrink-0 items-center justify-center"
		>
			<Icon className={cn("size-3.5", color)} />
		</span>
	);
}
