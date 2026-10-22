import type { QueueSpot } from "@stringsync/splates-server/conversations";
import type {
	QueueListing,
	RaiseOffer,
} from "@stringsync/splates-server/workers";
import { dollars } from "@stringsync/splates-server/workers/browser";
import {
	ArrowUpIcon,
	ArrowUpToLineIcon,
	CoinsIcon,
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
import { useMachine } from "./machine";
import { raiseWorkerLimit } from "./worker-budget-api";

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

/** What `offer` adds, like `+$0.06/h` or `+$0.50 today`. */
function raised(offer: RaiseOffer): string {
	return offer.limit === "hour"
		? `+${dollars(offer.dollars)}/h`
		: `+${dollars(offer.dollars)} ${offer.limit === "day" ? "today" : "this month"}`;
}

/**
 * Next to a queue the worker budget holds: what a raise costs and buys,
 * the worker's specs under it, and a button that asks once more in place
 * before raising the limit that holds it for a day.
 */
export function RaiseOfferButton({
	offer,
}: {
	offer: RaiseOffer | null | undefined;
}): JSX.Element | null {
	const [step, setStep] = useState<"idle" | "asking" | "raising" | "raised">(
		"idle",
	);
	const [error, setError] = useState<string | null>(null);
	if (offer == null) {
		return null;
	}
	const buys = `starts 1 more worker, which clears ${offer.clears} queued ${offer.clears === 1 ? "task" : "tasks"}`;
	const raise = () => {
		setStep("raising");
		setError(null);
		raiseWorkerLimit(offer.limit, offer.dollars, "1d").then(
			() => setStep("raised"),
			(caught: unknown) => {
				setStep("idle");
				setError(caught instanceof ApiError ? caught.message : String(caught));
			},
		);
	};
	return (
		<div data-slot="raise-offer" className="flex flex-col gap-0.5">
			<div className="flex items-center gap-2">
				<span className="min-w-0 flex-1 text-foreground text-xs">
					{raised(offer)} {buys}
				</span>
				{step === "asking" ? (
					<>
						<Button size="sm" onClick={raise}>
							Raise for a day
						</Button>
						<Button size="sm" variant="ghost" onClick={() => setStep("idle")}>
							Cancel
						</Button>
					</>
				) : (
					<Button
						variant="outline"
						size="sm"
						className="shrink-0"
						disabled={step === "raising" || step === "raised"}
						onClick={() => setStep("asking")}
					>
						<CoinsIcon />
						{step === "raised" ? "Raised" : `Raise ${raised(offer)}`}
					</Button>
				)}
			</div>
			<span className="text-muted-foreground text-xs">
				A {offer.type} on {offer.platform}: {offer.slots} slots at{" "}
				{dollars(offer.dollarsPerHour)}/h.
			</span>
			{error !== null && (
				<span className="text-destructive text-xs">{error}</span>
			)}
		</div>
	);
}

/** The offer for the banner, asked of the machine's reading only while one is held. */
function BannerOffer(): JSX.Element | null {
	const machine = useMachine();
	return <RaiseOfferButton offer={machine?.workerBudget?.offer} />;
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
			? `Every worker it can run on is full. It has waited ${span}, and starts on its own once a slot frees.`
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
	if (reason.endsWith(" reached")) {
		return `No worker it can run on is free, and no other is made: the worker budget's ${reason}. It has waited ${span}, and starts once a slot frees or the budget is raised.`;
	}
	if (reason === "worker draining") {
		return `The worker it can run on is draining, so it takes no new agents (as when it is being removed or updated to the server's build). It has waited ${span}, and starts once a worker takes work again.`;
	}
	if (reason === "no worker up") {
		return `No worker is up to run it. It has waited ${span}, and starts once a worker joins.`;
	}
	return `It ${reason}, and no worker on it is up. It has waited ${span}, and starts once one joins.`;
}

/**
 * What to try for a wait at `spot` that wants the person, past
 * `QUEUE_LATE` or at once, held for queued task `held` or else for a slot:
 * a line on it, and what to do, or null when the banner already offers it.
 */
function lateSays(spot: QueueSpot, held: number | null): string | null {
	const { reason } = spot;
	if (
		reason.startsWith("needs you") ||
		reason.startsWith(REFUSED) ||
		reason.endsWith(" reached")
	) {
		return null;
	}
	if (reason === "starting") {
		return "Taking longer than usual. A fresh install can take a few minutes; if the start fails, this says why.";
	}
	return held === null ||
		reason === "no free slot" ||
		reason === "worker draining"
		? "Taking longer than usual. The Workers page shows what holds each slot, and can wake or add a worker."
		: null;
}

/**
 * Under a conversation's header while its agent waits for a slot on a
 * worker, or is held for a queued task until the queue starts it, across the
 * pane's padding to its edges: where it is in line, how long it has waited
 * and why, so the person does not take the wait for a hang. Past
 * `QUEUE_LATE`, or at once when only the person can move it, it says what to
 * try and offers it: the Workers page, the task in the way, or a retry.
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
							href="#workers"
							className={cn(
								buttonVariants({ variant: "outline", size: "sm" }),
								"shrink-0",
							)}
						>
							<ServerIcon />
							Open Workers
						</a>
					)}
				</div>
			)}
			{reason.endsWith(" reached") && <BannerOffer />}
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
	offer,
}: {
	/** What a raise would buy, when the worker budget holds the queue. */
	offer?: RaiseOffer | null;
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
				<RaiseOfferButton offer={offer} />
			</PopoverContent>
		</Popover>
	);
}

function basename(path: string): string {
	return path.slice(path.lastIndexOf("/") + 1);
}
