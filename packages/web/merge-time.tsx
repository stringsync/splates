import type { Need } from "@stringsync/splates-server/plans";
import type { JSX } from "react";
import { Duration } from "webappwiz/time";
import { useNow } from "./hooks/use-now";
import { cn } from "./lib/utils";

/**
 * Past these a merge reads as slow, then as stuck. A gate is killed at 3
 * minutes, so a merge or two queued ahead stays under the first.
 */
export const MERGE_SLOW = Duration.mins(5);
export const MERGE_STUCK = Duration.mins(15);

/**
 * How long a task's merge has taken since it was asked for, its wait for the
 * premerge lock included, in whole minutes: muted while it is usual, amber
 * once slow and red once it looks stuck. Nothing for an agent not merging,
 * nor in its first minute, to keep the list calm.
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
	const now = useNow(since !== null, Duration.secs(15));
	if (since === null) {
		return null;
	}
	const elapsed = now - Date.parse(since);
	if (elapsed < Duration.mins(1).ms) {
		return null;
	}
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
			{minutes(elapsed)}
		</span>
	);
}

/** `elapsed` ms as `3m`, or `1h 5m` from an hour. */
function minutes(elapsed: number): string {
	const mins = Math.floor(elapsed / Duration.mins(1).ms);
	return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
}
