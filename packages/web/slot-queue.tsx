import type { QueueSpot } from "@stringsync/splates/conversation-state";
import type { QueueListing } from "@stringsync/splates/queue-list";
import { ArrowUpIcon, ArrowUpToLineIcon, HourglassIcon } from "lucide-react";
import { type JSX, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#web/components/ui/popover.tsx";
import { cn } from "#web/lib/utils.ts";
import { ApiError, moveQueued } from "./api";
import { useNow } from "./hooks/use-now";

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

/**
 * Under a conversation's header while its agent waits for a slot on a
 * worker, across the pane's padding to its edges: where it is in line, how
 * long it has waited and why, so the person does not take the wait for a
 * hang, and a way to put it first.
 */
export function QueueBanner({
	id,
	spot,
	phone,
}: {
	id: string;
	spot: QueueSpot;
	phone: boolean;
}): JSX.Element {
	const now = useNow();
	const { move, error } = useMove();
	return (
		<div
			role="status"
			data-slot="queue-banner"
			className={cn(
				phone ? "-mx-1" : "-mx-4",
				"flex shrink-0 items-center gap-2 border-y bg-muted px-4 py-2 text-muted-foreground text-sm",
			)}
		>
			<HourglassIcon className="size-4 shrink-0" />
			<span className="min-w-0 flex-1">
				<span className="font-medium text-foreground">
					Waiting for a slot, {ordinal(spot.position)} of {spot.of} in line.
				</span>{" "}
				{spot.reason === "no free slot"
					? `Every worker it can run on is full. It has waited ${waited(spot.since, now)}, and starts on its own once a slot frees.`
					: `It ${spot.reason}, and no worker on it is up. It has waited ${waited(spot.since, now)}, and starts once one joins.`}
				{error !== null && (
					<span className="block text-destructive">{error}</span>
				)}
			</span>
			{spot.position > 1 && (
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
		</div>
	);
}

/**
 * Where a conversation waits in the queue, for a mark on its task's row:
 * its place in line, with why in its title.
 */
export function QueueMark({ spot }: { spot: QueueSpot }): JSX.Element {
	return (
		<span
			role="img"
			aria-label={`${ordinal(spot.position)} in line for a slot`}
			title={`Waiting for a slot, ${ordinal(spot.position)} of ${spot.of}: ${spot.reason}`}
			className="inline-flex items-center gap-0.5 whitespace-nowrap text-muted-foreground text-xs tabular-nums"
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
				className="flex shrink-0 items-center gap-1.5 rounded-full border bg-muted px-2 py-0.5 font-medium text-[11px] text-muted-foreground leading-none"
			>
				<HourglassIcon className="size-3" />
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
							{entry.position > 1 && (
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
