import type { Need } from "@stringsync/splates-server/plans";
import type { JSX } from "react";
import { Duration } from "webappwiz/time";
import { useNow } from "./hooks/use-now";
import { cn } from "./lib/utils";
import { span } from "./work";

/**
 * Past these a merge reads as slow, then as stuck. A gate is killed at 3
 * minutes, so a merge or two queued ahead stays under the first.
 */
export const MERGE_SLOW = Duration.mins(5);
export const MERGE_STUCK = Duration.mins(15);

/**
 * How long a task's merge has taken since it was asked for, its wait for the
 * premerge lock included, ticking: muted while it is usual, amber once slow
 * and red once it looks stuck. Nothing for an agent not merging.
 */
export function MergeTime({
	need,
	className,
}: {
	need: Need;
	className?: string;
}): JSX.Element | null {
	const since =
		need.kind === "working" && need.merge !== undefined
			? (need.mergeSince ?? null)
			: null;
	const now = useNow(since !== null);
	if (since === null) {
		return null;
	}
	const elapsed = now - Date.parse(since);
	return (
		<span
			title="Time since the merge was asked for, its wait for its turn included"
			className={cn(
				"shrink-0 text-xs tabular-nums",
				elapsed >= MERGE_STUCK.ms
					? "text-destructive"
					: elapsed >= MERGE_SLOW.ms
						? "text-warning"
						: "text-muted-foreground",
				className,
			)}
		>
			{span(since, now)}
		</span>
	);
}
