import type { RunState } from "@splates/server/ship";
import type { JSX, ReactNode } from "react";
import { useNow } from "./hooks/use-now";
import { cn } from "./lib/utils";
import { spanOf } from "./merge-lines";
import type { RunSummary } from "./ship-run-summary";

/**
 * The card on top, kept in view as the page scrolls: "1 of 5 done", the time
 * the run has taken, and the bar with Stop beside it while the run is under way.
 */
export function ShipRunProgress({
	run,
	summary,
	stop,
}: {
	run: RunState;
	summary: RunSummary;
	stop?: ReactNode;
}): JSX.Element {
	const running = run.status === "running";
	const now = useNow(running);
	const ended = Math.max(
		run.started,
		...run.targets.flatMap((target) =>
			target.steps.flatMap((step) => step.ended ?? []),
		),
	);
	const { done, total, finished, count } = summary;
	const said =
		run.status === "done"
			? "Shipped"
			: run.status === "stopped"
				? `Stopped by you, ${done} of ${total} done`
				: run.status === "failed"
					? `Stopped on a failure, ${done} of ${total} done`
					: `Shipping · ${done} of ${total} done`;
	return (
		<div className="flex flex-col gap-2.5 rounded-xl border bg-card px-4 py-3.5 shadow-xs">
			<p className="flex items-baseline justify-between gap-3 font-semibold text-sm">
				<span>{said}</span>
				<span className="font-normal text-muted-foreground text-xs tabular-nums">
					{spanOf((running ? now : ended) - run.started)}
				</span>
			</p>
			<div className="flex items-center gap-3">
				<div
					role="progressbar"
					aria-label="Steps done"
					aria-valuemin={0}
					aria-valuemax={count}
					aria-valuenow={finished}
					className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
				>
					<div
						// The bar moves with each step, so a run of one target fills as it goes.
						className={cn(
							"h-full rounded-full transition-[width] duration-500",
							run.status === "failed" ? "bg-destructive" : "bg-foreground",
						)}
						style={{ width: `${count === 0 ? 0 : (finished / count) * 100}%` }}
					/>
				</div>
				{stop}
			</div>
		</div>
	);
}
