import { age } from "@splates/server/age";
import type { CascadeSummary } from "@splates/server/ship";
import { shipName } from "@splates/server/ship/browser";
import { CheckIcon, ChevronRightIcon, MinusIcon, XIcon } from "lucide-react";
import { type JSX, useState } from "react";
import { Skeleton } from "#web/components/ui/skeleton.tsx";
import { cn } from "./lib/utils";

const FILTERS = ["All", "Shipped", "Failed"] as const;
type Filter = (typeof FILTERS)[number];

const WEEK = 7 * 24 * 60 * 60 * 1000;

/**
 * Every ship that ended, newest first, under This week and Earlier, which the
 * filter narrows to those that shipped or failed; each row opens its ship.
 */
export function ShipHistory({
	cascades,
}: {
	/** Null until the list arrives, when its place is held. */
	cascades: CascadeSummary[] | null;
}): JSX.Element {
	const [filter, setFilter] = useState<Filter>("All");
	const ended = (cascades ?? []).filter((each) => each.status !== "running");
	const kept = ended.filter(
		(each) =>
			filter === "All" ||
			outcomeOf(each) === (filter === "Shipped" ? "shipped" : "failed"),
	);
	const recent = kept.filter(
		(each) => Date.now() - Date.parse(each.started) < WEEK,
	);
	const earlier = kept.filter((each) => !recent.includes(each));
	return (
		<section aria-label="history" className="flex flex-col gap-4">
			<div className="flex gap-2">
				{FILTERS.map((each) => (
					<button
						key={each}
						type="button"
						aria-pressed={filter === each}
						onClick={() => setFilter(each)}
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
			{cascades === null ? (
				<Skeleton className="h-5 w-full animate-pulse" />
			) : kept.length === 0 ? (
				<p className="text-muted-foreground text-sm">
					{ended.length === 0
						? "No ships yet."
						: `No ${filter.toLowerCase()} ships.`}
				</p>
			) : (
				<>
					<Group title="This week" cascades={recent} />
					<Group title="Earlier" cascades={earlier} />
				</>
			)}
		</section>
	);
}

function Group({
	title,
	cascades,
}: {
	title: string;
	cascades: CascadeSummary[];
}): JSX.Element | null {
	if (cascades.length === 0) {
		return null;
	}
	return (
		<div className="flex flex-col gap-1">
			<h2 className="font-medium text-muted-foreground text-xs">{title}</h2>
			<ul className="flex flex-col divide-y rounded-lg border bg-card px-3">
				{cascades.map((each) => (
					<Past key={each.id} summary={each} />
				))}
			</ul>
		</div>
	);
}

type Outcome = "shipped" | "failed" | "neutral";

/** How a past ship ended: shipped, failed (stopped), or neither (abandoned, still going). */
export function outcomeOf(summary: CascadeSummary): Outcome {
	if (summary.status === "done") {
		return "shipped";
	}
	return summary.status === "stopped" ? "failed" : "neutral";
}

const OUTCOME_WORDS: Record<Outcome, string> = {
	shipped: "Shipped",
	failed: "Failed",
	neutral: "Not finished",
};

/** The version the ship started from took, as `v1.2.3`; empty for a changed-projects run. */
function versionOf(summary: CascadeSummary): string {
	const to = summary.projects.find((each) => each.slug === summary.from)?.to;
	return to == null ? "" : `v${to}`;
}

/** The most of a failure reason the list shows; the rest is on the ship's page. */
const REASON_LIMIT = 120;

/** The first line of the note of the project the run stopped at, cut to {@link REASON_LIMIT}, or null. */

function reasonOf(summary: CascadeSummary): string | null {
	const stopped = summary.projects.find(
		(each) => each.status !== "done" && each.status !== "dropped",
	);
	const line = stopped?.note?.split("\n")[0];
	if (line == null) {
		return null;
	}
	return line.length > REASON_LIMIT
		? `${line.slice(0, REASON_LIMIT - 1)}…`
		: line;
}

function OutcomeIcon({ outcome }: { outcome: Outcome }): JSX.Element {
	const Icon =
		outcome === "shipped"
			? CheckIcon
			: outcome === "failed"
				? XIcon
				: MinusIcon;
	return (
		<Icon
			aria-label={OUTCOME_WORDS[outcome]}
			className={`size-4 shrink-0 ${
				outcome === "shipped"
					? "text-green-600 dark:text-green-400"
					: outcome === "failed"
						? "text-red-600 dark:text-red-400"
						: "text-muted-foreground"
			}`}
		/>
	);
}

function Past({ summary }: { summary: CascadeSummary }): JSX.Element {
	const outcome = outcomeOf(summary);
	const reason = outcome === "failed" ? reasonOf(summary) : null;
	return (
		<li aria-label={summary.id} className="py-2">
			<a
				href={`#ships/${encodeURIComponent(summary.id)}`}
				className="flex min-w-0 flex-col gap-0.5 text-sm"
			>
				<span className="flex min-w-0 items-center gap-2">
					<OutcomeIcon outcome={outcome} />
					<span className="truncate font-medium">{shipName(summary.from)}</span>
					<span className="shrink-0 text-muted-foreground">
						{versionOf(summary)}
					</span>
					{summary.projects.length > 1 && (
						<span className="shrink-0 text-muted-foreground text-xs">
							{summary.projects.length} projects
						</span>
					)}
					<time
						dateTime={summary.started}
						className="ml-auto shrink-0 text-muted-foreground"
					>
						{age(summary.started)} ago
					</time>
					<ChevronRightIcon aria-hidden className="size-3.5 shrink-0" />
				</span>
				{reason !== null && (
					<span className="truncate pl-6 text-red-600 text-xs dark:text-red-400">
						{reason}
					</span>
				)}
			</a>
		</li>
	);
}
