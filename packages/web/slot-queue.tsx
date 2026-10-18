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
} from "lucide-react";
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
				"flex shrink-0 flex-col gap-2 border-y bg-muted px-4 py-2 text-muted-foreground text-sm",
			)}
		>
			<div className="flex items-center gap-2">
				<HourglassIcon className="size-4 shrink-0" />
				<span className="min-w-0 flex-1">
					<span className="font-medium text-foreground">
						Waiting for a slot, {ordinal(spot.position)} of {spot.of} in line.
					</span>{" "}
					{spot.reason === "no free slot"
						? `Every worker it can run on is full. It has waited ${waited(spot.since, now)}, and starts on its own once a slot frees.`
						: spot.reason.endsWith(" reached")
							? `No worker it can run on is free, and no other is made: the worker budget's ${spot.reason}. It has waited ${waited(spot.since, now)}, and starts once a slot frees or the budget is raised.`
							: spot.reason === "no worker up"
								? `No worker is up to run it. It has waited ${waited(spot.since, now)}, and starts once a worker joins.`
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
			{spot.reason.endsWith(" reached") && <BannerOffer />}
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
				<RaiseOfferButton offer={offer} />
			</PopoverContent>
		</Popover>
	);
}

function basename(path: string): string {
	return path.slice(path.lastIndexOf("/") + 1);
}
