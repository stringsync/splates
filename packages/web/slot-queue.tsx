import type { QueueSpot } from "@stringsync/splates-server/conversations";
import type { QueueListing } from "@stringsync/splates-server/workers";
import {
	ArrowUpIcon,
	ArrowUpToLineIcon,
	HourglassIcon,
	ListTodoIcon,
	RotateCwIcon,
	ServerIcon,
} from "lucide-react";
import { type JSX, useContext, useState } from "react";
import { Duration } from "webappwiz/time";
import { Button, buttonVariants } from "#web/components/ui/button.tsx";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#web/components/ui/popover.tsx";
import { cn } from "#web/lib/utils.ts";
import { ApiError, moveQueued, retryQueuedStart } from "./api";
import { Board } from "./board";
import { useNow } from "./hooks/use-now";
import { STATUS_PILL } from "./status-pill";

/** `place` as a place in line: 1st, 2nd, 3rd, 4th. */
export function ordinal(place: number): string {
	const tens = place % 100;
	const suffix =
		tens >= 11 && tens <= 13
			? "th"
			: (["th", "st", "nd", "rd"][place % 10] ?? "th");
	return `${place}${suffix}`;
}

/** How long since `since`, an ISO time, as `4m` or `1h 5m`, up to `now`. */
function waited(since: string, now: number): string {
	const mins = Math.max(0, Math.floor((now - Date.parse(since)) / 60_000));
	if (mins < 1) {
		return "under a minute";
	}
	return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

/**
 * Moves conversation `id` to `position` in the queue, keeping why it was
 * refused, as when it got its slot meanwhile.
 */
function useMove(): {
	move: (id: string, position: number) => void;
	error: string | null;
} {
	const [error, setError] = useState<string | null>(null);
	return {
		error,
		move: (id, position) => {
			setError(null);
			moveQueued(id, position).catch((caught: unknown) =>
				setError(caught instanceof ApiError ? caught.message : String(caught)),
			);
		},
	};
}

/** How long a wait goes before the page calls it longer than usual. */
export const QUEUE_LATE = Duration.mins(1);

/**
 * Whether the wait at `spot` wants the person by `now`: at once for a start
 * refused or a blocker removed, past `QUEUE_LATE` for any other but one on a
 * blocker still open, which is meant to wait.
 */
export function queueWantsYou(spot: QueueSpot, now: number): boolean {
	if (spot.reason.startsWith("needs you") || spot.reason.startsWith(REFUSED)) {
		return true;
	}
	return (
		!spot.reason.startsWith("waits on") &&
		now - Date.parse(spot.since) >= QUEUE_LATE.ms
	);
}

/** How the queue's runner begins the reason for a start it was refused. */
const REFUSED = "could not start: ";

/** The task numbers `reason` names, as in "waits on #3, #4". */
function numbersIn(reason: string): number[] {
	return [...reason.matchAll(/#(\d+)/g)].map(([, id]) => Number(id));
}

/**
 * Why a conversation at `spot` waits, held for queued task `held` or else in
 * the line for a worker's slot, having waited `span`.
 */
function waitSays(spot: QueueSpot, held: number | null, span: string): string {
	const { reason } = spot;
	if (reason === "no free slot") {
		return held === null
			? `Every slot is taken. It has waited ${span}, and starts on its own once a slot frees.`
			: `Every agent slot is taken. It has waited ${span}, and starts on its own once a slot frees.`;
	}
	if (reason === "starting") {
		return `Its task is starting, readying a worktree and installing. It has been at it ${span}.`;
	}
	if (reason.startsWith("waits on")) {
		const ids = numbersIn(reason).map((id) => `#${id}`);
		return `It waits on ${ids.join(", ")} to land first, and starts once ${ids.length === 1 ? "it does" : "they do"}.`;
	}
	if (reason.startsWith("needs you")) {
		const ids = numbersIn(reason).map((id) => `#${id}`);
		return `${ids.join(", ")}, which it waits on, ${ids.length === 1 ? "was" : "were"} removed, so it cannot start: unlink ${ids.length === 1 ? "it" : "them"}, or restore ${ids.length === 1 ? "it" : "them"}.`;
	}
	if (reason.startsWith(REFUSED)) {
		return `Its task could not start: ${reason.slice(REFUSED.length)}. Fix what that says, then retry.`;
	}
	if (reason === "paused") {
		return `The queue is paused, so what splates starts on its own waits. It has waited ${span}, and starts once you resume it on the Queue page.`;
	}
	if (reason === "worker draining") {
		return `This machine's worker is draining, so it takes no new agents (as when it is being updated to the server's build). It has waited ${span}, and starts once a worker takes work again.`;
	}
	if (reason === "no worker up") {
		return `This machine's worker is not up. It has waited ${span}, and starts once it joins.`;
	}
	return `It ${reason}. It has waited ${span}.`;
}

/**
 * What to try for a wait at `spot` that wants the person, past
 * `QUEUE_LATE` or at once, held for queued task `held` or else for a slot:
 * a line on it, and what to do, or null when the banner already offers it.
 */
function lateSays(spot: QueueSpot, held: number | null): string | null {
	const { reason } = spot;
	if (reason.startsWith("needs you") || reason.startsWith(REFUSED)) {
		return null;
	}
	if (reason === "starting") {
		return "Taking longer than usual. A fresh install can take a few minutes; if the start fails, this says why.";
	}
	return held === null ||
		reason === "no free slot" ||
		reason === "worker draining" ||
		reason === "paused"
		? "Taking longer than usual. The Queue page shows what holds each slot."
		: null;
}

/**
 * Under a conversation's header while its agent waits for a slot on a
 * worker, or is held for a queued task until the queue starts it, across the
 * pane's padding to its edges: where it is in line, how long it has waited
 * and why, so the person does not take the wait for a hang. Past
 * `QUEUE_LATE`, or at once when only the person can move it, it says what to
 * try and offers it: the Queue page, the task in the way, or a retry.
 */
export function QueueBanner({
	id,
	spot,
	held,
	phone,
}: {
	id: string;
	spot: QueueSpot;
	/** The queued task it is held for, or null for one in the line for a slot. */
	held: number | null;
	phone: boolean;
}): JSX.Element {
	const now = useNow();
	const board = useContext(Board);
	const { move, error: moveError } = useMove();
	const { retry, retrying, error: retryError } = useRetry();
	const error = moveError ?? retryError;
	const wants = queueWantsYou(spot, now);
	const late = wants ? lateSays(spot, held) : null;
	const { reason } = spot;
	const [blocker] = numbersIn(reason);
	return (
		<div
			role="status"
			data-slot="queue-banner"
			className={cn(
				phone ? "-mx-1" : "-mx-4",
				"flex shrink-0 flex-col gap-2 border-y bg-muted px-4 py-2 text-muted-foreground text-sm",
			)}
		>
			<div className="flex items-center gap-2">
				<HourglassIcon
					className={cn("size-4 shrink-0", wants && "text-warning")}
				/>
				<span className="min-w-0 flex-1">
					<span className="font-medium text-foreground">
						{held === null
							? `Waiting for a slot, ${ordinal(spot.position)} of ${spot.of} in line.`
							: `Queued, ${ordinal(spot.position)} of ${spot.of} to start.`}
					</span>{" "}
					{waitSays(spot, held, waited(spot.since, now))}
					{error !== null && (
						<span className="block text-destructive">{error}</span>
					)}
				</span>
				{held === null && spot.position > 1 && (
					<Button
						variant="outline"
						size="sm"
						className="shrink-0"
						onClick={() => move(id, 1)}
					>
						<ArrowUpToLineIcon />
						Start next
					</Button>
				)}
				{held !== null && reason.startsWith(REFUSED) && (
					<Button
						variant="outline"
						size="sm"
						className="shrink-0"
						disabled={retrying}
						onClick={() => retry(held)}
					>
						<RotateCwIcon />
						Retry
					</Button>
				)}
				{held !== null && reason.startsWith("needs you") && board.linked && (
					<Button
						variant="outline"
						size="sm"
						className="shrink-0"
						onClick={() => board.open(held)}
					>
						<ListTodoIcon />
						Open #{held}
					</Button>
				)}
				{reason.startsWith("waits on") &&
					blocker !== undefined &&
					board.linked && (
						<Button
							variant="ghost"
							size="sm"
							className="shrink-0"
							onClick={() => board.open(blocker)}
						>
							<ListTodoIcon />
							Open #{blocker}
						</Button>
					)}
			</div>
			{late !== null && (
				<div
					data-slot="queue-late"
					className="flex items-center gap-2 border-border/60 border-t pt-2"
				>
					<span className="min-w-0 flex-1 text-foreground">{late}</span>
					{reason !== "starting" && (
						<a
							href="#tasks"
							className={cn(
								buttonVariants({ variant: "outline", size: "sm" }),
								"shrink-0",
							)}
						>
							<ServerIcon />
							Open Queue
						</a>
					)}
				</div>
			)}
		</div>
	);
}

/**
 * Tries a queued task's refused start again, keeping why that was refused
 * in turn, and whether one is under way.
 */
function useRetry(): {
	retry: (todo: number) => void;
	retrying: boolean;
	error: string | null;
} {
	const [retrying, setRetrying] = useState(false);
	const [error, setError] = useState<string | null>(null);
	return {
		retrying,
		error,
		retry: (todo) => {
			setRetrying(true);
			setError(null);
			retryQueuedStart(todo)
				.catch((caught: unknown) =>
					setError(
						caught instanceof ApiError ? caught.message : String(caught),
					),
				)
				.finally(() => setRetrying(false));
		},
	};
}

/**
 * Where a conversation waits in the queue, for a mark on its task's row:
 * its place in line, with why in its title, in the warning's color once the
 * wait wants the person.
 */
export function QueueMark({ spot }: { spot: QueueSpot }): JSX.Element {
	const wants = queueWantsYou(spot, useNow());
	return (
		<span
			role="img"
			aria-label={`${ordinal(spot.position)} in line for a slot`}
			title={`${ordinal(spot.position)} of ${spot.of} in line: ${spot.reason}${wants ? ". Taking longer than usual: open it for what to try." : ""}`}
			className={cn(
				"inline-flex items-center gap-0.5 whitespace-nowrap text-xs tabular-nums",
				wants ? "text-warning" : "text-muted-foreground",
			)}
		>
			<HourglassIcon className="size-3" />
			{spot.position}
		</span>
	);
}

/**
 * In the header while any agent waits for a slot on a worker: how many, and,
 * opened, the queue first in line first, each with a way to move it up.
 */
export function QueueBadge({
	queue,
	nameOf,
}: {
	queue: QueueListing[];
	/** What to call the conversation `id`, when the page holds it. */
	nameOf?: (id: string) => string | null;
}): JSX.Element | null {
	const now = useNow(queue.length > 0);
	const { move, error } = useMove();
	if (queue.length === 0) {
		return null;
	}
	return (
		<Popover>
			<PopoverTrigger
				role="status"
				title="Agents waiting for a slot on a worker"
				className={`${STATUS_PILL} bg-muted text-muted-foreground`}
			>
				<HourglassIcon />
				{queue.length} queued
			</PopoverTrigger>
			<PopoverContent align="start" className="w-80">
				<p className="font-medium text-sm">Waiting for a slot</p>
				<p className="text-muted-foreground text-xs">
					First come, first served; each starts once a slot frees.
				</p>
				<ol aria-label="Queue" className="flex flex-col gap-1">
					{queue.map((entry) => (
						<li key={entry.id} className="flex items-center gap-2 text-sm">
							<span className="w-5 shrink-0 text-right text-muted-foreground tabular-nums">
								{entry.position}
							</span>
							<span className="min-w-0 flex-1">
								<span className="block truncate">
									{entry.task ?? nameOf?.(entry.id) ?? "a conversation"}
								</span>
								<span className="block truncate text-muted-foreground text-xs">
									{basename(entry.project)} · {waited(entry.since, now)} ·{" "}
									{entry.reason}
								</span>
							</span>
							{entry.position > 1 && entry.queued !== true && (
								<Button
									variant="ghost"
									size="icon"
									aria-label={`Move ${entry.task ?? "it"} up`}
									title="Move up"
									onClick={() => move(entry.id, entry.position - 1)}
								>
									<ArrowUpIcon />
								</Button>
							)}
						</li>
					))}
				</ol>
				{error !== null && <p className="text-destructive text-xs">{error}</p>}
			</PopoverContent>
		</Popover>
	);
}

function basename(path: string): string {
	return path.slice(path.lastIndexOf("/") + 1);
}
