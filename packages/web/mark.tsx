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
	leftover = false,
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
	/** Whether it waits on a command in the background its agent will come back for. */
	background?: boolean;
	/** Whether its agent only left commands running, which it will not come back for. */
	leftover?: boolean;
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
	const shows = need.kind === "idle";
	const failedDisconnected =
		disconnected && need.kind === "waiting" && need.why === "failed";
	// A process failure can happen after the agent reports its final outcome.
	if (
		((shows && !signal) || failedDisconnected) &&
		(!subagent || disconnected)
	) {
		if (reported === "merged" || reported === "done") {
			return (
				<Glyph
					icon={CircleCheckIcon}
					role="img"
					aria-label={reported}
					color="text-success"
				/>
			);
		}
		if (reported === "removed" && !hosting) {
			return (
				<Glyph
					icon={CircleSlashIcon}
					role="img"
					aria-label="removed"
					color="text-muted-foreground"
				/>
			);
		}
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
		if (failedDisconnected) {
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
			<Ellipsis
				role="status"
				aria-label="waiting"
				title="Waiting to continue automatically"
			/>
		);
	}
	// Waiting on blockers: the triangle while a blocker needs queuing, else
	// gray dots while its blockers are already handled.
	if (reported === "deferred" && shows && !hosting) {
		return blockedNeedsYou ? (
			<Glyph
				icon={TriangleAlertIcon}
				role="img"
				aria-label="deferred"
				color="text-warning"
			/>
		) : (
			<Ellipsis role="img" aria-label="deferred" />
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
				<Ellipsis
					role="status"
					aria-label="waiting on background commands"
					title="Waiting on background commands"
				/>
			);
		}
		if (disconnected) {
			return <Disconnected title="Disconnected" />;
		}
		if (leftover) {
			return <Disconnected title="Idle · commands left running" />;
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

/**
 * Each dot of `Ellipsis` by its centre, 0.2s behind the one to its left; the
 * delays are negative so every dot is already in motion at mount.
 */
const DOT_DELAYS = [
	{ cx: 5, delay: "0s" },
	{ cx: 12, delay: "-1s" },
	{ cx: 19, delay: "-0.8s" },
];

/**
 * Gray dots lighting up in turn, in a mark's box on Lucide's 24-unit grid as
 * its other icons are: work under way that carries on without anyone, where
 * the hourglass is for work yet to start.
 */
function Ellipsis(box: Omit<ComponentProps<"span">, "className">): JSX.Element {
	return (
		<span
			{...box}
			className="flex size-3.5 shrink-0 items-center justify-center"
		>
			<svg
				aria-hidden="true"
				viewBox="0 0 24 24"
				className="mark-ellipsis size-3.5 fill-current text-muted-foreground"
			>
				{DOT_DELAYS.map(({ cx, delay }) => (
					<circle
						key={cx}
						cx={cx}
						cy={12}
						r={2.5}
						className="animate-dot motion-reduce:animate-none"
						style={{ animationDelay: delay }}
					/>
				))}
			</svg>
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
