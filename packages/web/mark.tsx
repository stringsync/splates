import type { ConversationState } from "@splates/server/conversations";
import type { Ending, Need } from "@splates/server/plans";
import {
	CircleCheckIcon,
	CircleSlashIcon,
	GitMergeIcon,
	HourglassIcon,
	Loader2Icon,
	type LucideIcon,
	StarIcon,
	TriangleAlertIcon,
	UnplugIcon,
} from "lucide-react";
import type { ComponentProps, CSSProperties, JSX } from "react";
import { cn } from "#web/lib/utils.ts";
import { waitsOn } from "./conversation-names";
import { Dot } from "./dot";
import { placeInLine } from "./merge-place";
import { type Quiet, quietTitle } from "./quiet";

/** Whether a conversation has no live or starting agent process (excluding queued-to-start holds). */
export function isDisconnected(
	conversation: Pick<ConversationState, "status" | "heldForTask"> | null,
): boolean {
	return (
		conversation !== null &&
		(conversation.status === "stopped" || conversation.status === "failed") &&
		conversation.heldForTask == null
	);
}

/** A conversation's status icon in a list. */
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
	signal = false,
	blockedNeedsYou = false,
	disconnected = false,
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
	/** Whether its agent waits on a signal. */
	signal?: boolean;
	/** Whether its blocked task waits on a blocker nobody has queued. */
	blockedNeedsYou?: boolean;
	/** Whether its agent has no live connection (stopped or failed). */
	disconnected?: boolean;
}): JSX.Element {
	if (need.kind === "working" && need.merge === "running") {
		return (
			<span
				role="status"
				aria-label="merging"
				title={need.leads === true ? "Merging, leading a batch" : "Merging"}
				className="relative flex size-3.5 shrink-0 items-center justify-center"
			>
				<GitMergeIcon className="size-3.5 text-info" />
				{need.leads === true ? (
					<StarIcon
						aria-hidden
						className="-top-1 -right-1 absolute size-2.5 animate-pulse fill-info text-info"
						style={pulseInSync()}
					/>
				) : (
					<span
						aria-hidden
						className="-top-0.5 -right-0.5 absolute size-1.5 animate-pulse rounded-full bg-info ring-2 ring-info/25"
						style={pulseInSync()}
					/>
				)}
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
				className="relative flex size-3.5 shrink-0 items-center justify-center"
			>
				<GitMergeIcon className="size-3.5 text-muted-foreground" />
				{need.mergePlace !== undefined && (
					<span
						aria-hidden
						className="-top-1 -right-1.5 absolute flex h-2.5 min-w-2.5 items-center justify-center rounded-full bg-muted px-px font-semibold text-[7px] text-muted-foreground leading-[10px]"
					>
						{need.mergePlace}
					</span>
				)}
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
				signal={signal}
				disconnected={disconnected}
			/>
		);
	}
	if (need.kind === "waiting") {
		if (need.why === "failed" && disconnected) {
			return <Disconnected title={need.subject} />;
		}
		return (
			<Glyph
				icon={TriangleAlertIcon}
				role="status"
				aria-label="waiting on you"
				title={need.subject}
				color="text-warning"
			/>
		);
	}
	if (signal) {
		return (
			<Glyph
				icon={HourglassIcon}
				role="status"
				aria-label="waiting"
				title="Waiting to continue automatically"
				color="text-muted-foreground"
			/>
		);
	}
	const shows = need.kind === "idle";
	if ((reported === "merged" || reported === "done") && shows) {
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
				icon={CircleSlashIcon}
				role="img"
				aria-label="removed"
				color="text-muted-foreground"
			/>
		);
	}
	// Waiting on blockers: the triangle while a blocker needs queuing, else a
	// gray hourglass while its blockers are already handled.
	if (reported === "deferred" && shows && !hosting) {
		return (
			<Glyph
				icon={blockedNeedsYou ? TriangleAlertIcon : HourglassIcon}
				role="img"
				aria-label="deferred"
				color={blockedNeedsYou ? "text-warning" : "text-muted-foreground"}
			/>
		);
	}
	if (
		unread &&
		need.kind === "idle" &&
		!hosting &&
		!signal &&
		!waitsOn(reported)
	) {
		return <Dot role="status" aria-label="unread" color="bg-info" />;
	}
	if (waitsOn(reported) && shows) {
		return (
			<Glyph
				icon={TriangleAlertIcon}
				role="status"
				aria-label="waiting on you"
				color="text-warning"
			/>
		);
	}
	if (need.kind === "idle" && !hosting) {
		if (background) {
			return (
				<Glyph
					icon={HourglassIcon}
					role="status"
					aria-label="agent idle with background commands"
					title="Agent idle · background commands running"
					color="text-muted-foreground"
				/>
			);
		}
		if (disconnected) {
			return <Disconnected title="Disconnected" />;
		}
		// Empty, so what sits beside it lines up with the rows that have one.
		return <span className="size-3.5 shrink-0" />;
	}
	if (need.kind === "idle" && disconnected) {
		return <Disconnected title="Disconnected" />;
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
 * A muted gray unplugged icon for a conversation with no live agent process.
 */
function Disconnected({ title }: { title: string }): JSX.Element {
	return (
		<Glyph
			icon={UnplugIcon}
			role="status"
			aria-label="disconnected"
			title={title}
			color="text-muted-foreground"
		/>
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

/** Tailwind's `animate-pulse` period. */
const PULSE_MS = 2000;

/**
 * A negative delay that puts a pulse at the same point of its cycle as every
 * other merging mark, however late it mounted, so they glow together.
 */
function pulseInSync(): CSSProperties {
	return { animationDelay: `-${Date.now() % PULSE_MS}ms` };
}
