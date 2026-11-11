import { age } from "@splates/server/age";
import type { EvalBatch } from "@splates/server/evals/browser";
import { Dispatcher, type Eventful } from "core/events";
import { useReactive } from "core/react";
import { CheckIcon, ChevronRightIcon, MinusIcon, XIcon } from "lucide-react";
import { type JSX, useState } from "react";
import { cn } from "./lib/utils";

const FILTERS = ["All", "Passed", "Failed"] as const;
type Filter = (typeof FILTERS)[number];

const WEEK = 7 * 24 * 60 * 60 * 1000;

type Outcome = "passed" | "failed" | "pending";

/** How a batch came out: failed when a cell failed, errored or could not be read, pending while cells are still to land. */
export function outcomeOf(batch: EvalBatch): Outcome {
	const { fail = 0, error = 0, unreadable = 0, pending = 0 } = batch.tally;
	if (fail + error + unreadable > 0) {
		return "failed";
	}
	return pending > 0 ? "pending" : "passed";
}

/**
 * Every saved eval batch, newest first, under This week and Earlier, which
 * the filter narrows to those that passed or failed; each row opens its report,
 * where its agents, tokens and budget are.
 */
export function EvalHistory({
	batches,
	onOpen,
}: {
	batches: EvalBatch[];
	onOpen: (batch: string) => void;
}): JSX.Element {
	const [history] = useState(() => new HistoryFilter());
	const filter = useReactive(history, (each) => each.filter, ["changed"]);
	const { kept, recent, earlier } = history.split(batches);
	return (
		<section aria-label="history" className="flex flex-col gap-4">
			<div className="flex gap-2">
				{FILTERS.map((each) => (
					<button
						key={each}
						type="button"
						aria-pressed={filter === each}
						onClick={() => history.pick(each)}
						className={cn(
							"rounded-full border px-3 py-1 text-sm",
							filter === each
								? "border-primary bg-primary/10 text-primary"
								: "bg-card",
						)}
					>
						{each}
					</button>
				))}
			</div>
			{kept.length === 0 ? (
				<p className="text-muted-foreground text-sm">
					{batches.length === 0 ? (
						<>
							No eval has run on this machine yet. Each run of{" "}
							<code>evals run</code> is saved in ~/.splates/evals and shows
							here.
						</>
					) : (
						`No ${filter.toLowerCase()} runs.`
					)}
				</p>
			) : (
				<>
					<Group title="This week" batches={recent} onOpen={onOpen} />
					<Group title="Earlier" batches={earlier} onOpen={onOpen} />
				</>
			)}
		</section>
	);
}

function Group({
	title,
	batches,
	onOpen,
}: {
	title: string;
	batches: EvalBatch[];
	onOpen: (batch: string) => void;
}): JSX.Element | null {
	if (batches.length === 0) {
		return null;
	}
	return (
		<div className="flex flex-col gap-1">
			<h2 className="font-medium text-muted-foreground text-xs">{title}</h2>
			<ul className="flex flex-col divide-y rounded-lg border bg-card px-3">
				{batches.map((each) => (
					<Past key={each.id} batch={each} onOpen={onOpen} />
				))}
			</ul>
		</div>
	);
}

const OUTCOME_WORDS: Record<Outcome, string> = {
	passed: "Passed",
	failed: "Failed",
	pending: "Still running",
};

function Past({
	batch,
	onOpen,
}: {
	batch: EvalBatch;
	onOpen: (batch: string) => void;
}): JSX.Element {
	const outcome = outcomeOf(batch);
	const Icon =
		outcome === "passed" ? CheckIcon : outcome === "failed" ? XIcon : MinusIcon;
	return (
		<li aria-label={batch.id} className="py-2">
			<button
				type="button"
				onClick={() => onOpen(batch.id)}
				className="flex w-full min-w-0 items-center gap-2 text-left text-sm"
			>
				<Icon
					aria-label={OUTCOME_WORDS[outcome]}
					className={cn(
						"size-4 shrink-0",
						outcome === "passed" && "text-green-600 dark:text-green-400",
						outcome === "failed" && "text-red-600 dark:text-red-400",
						outcome === "pending" && "text-muted-foreground",
					)}
				/>
				<span className="truncate font-medium">{batch.skill ?? "evals"}</span>
				<span className="shrink-0 text-muted-foreground">
					{batch.cells} {batch.cells === 1 ? "cell" : "cells"}
				</span>
				{batch.costUsd !== null && (
					<span className="shrink-0 text-muted-foreground text-xs tabular-nums">
						${batch.costUsd.toFixed(2)}
					</span>
				)}
				<time
					dateTime={batch.startedAt}
					className="ml-auto shrink-0 text-muted-foreground"
				>
					{age(batch.startedAt)} ago
				</time>
				<ChevronRightIcon aria-hidden className="size-3.5 shrink-0" />
			</button>
		</li>
	);
}

type HistoryFilterEvents = { changed: undefined };

/** Which outcomes the history shows, and how it splits the batches that match. */
class HistoryFilter implements Eventful<HistoryFilterEvents> {
	private readonly dispatcher = new Dispatcher<HistoryFilterEvents>();
	readonly events = this.dispatcher.events;

	filter: Filter = "All";

	/** Shows the batches with outcome `filter`. */
	pick(filter: Filter): void {
		this.filter = filter;
		this.dispatcher.dispatch("changed");
	}

	/** The batches that match, and of those the ones from this week and the older. */
	split(batches: EvalBatch[]): {
		kept: EvalBatch[];
		recent: EvalBatch[];
		earlier: EvalBatch[];
	} {
		const kept = batches.filter(
			(each) =>
				this.filter === "All" ||
				outcomeOf(each) === (this.filter === "Passed" ? "passed" : "failed"),
		);
		const recent = kept.filter(
			(each) => Date.now() - Date.parse(each.startedAt) < WEEK,
		);
		return {
			kept,
			recent,
			earlier: kept.filter((each) => !recent.includes(each)),
		};
	}
}
