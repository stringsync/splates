import { TASK } from "@stringsync/splates-server/plans/browser";
import type { Snapshot } from "@stringsync/splates-server/tasks";
import { GitMergeIcon } from "lucide-react";
import { type JSX, useContext, useState } from "react";
import { Duration } from "webappwiz/time";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#web/components/ui/popover.tsx";
import { useNow } from "./hooks/use-now";
import { cn } from "./lib/utils";
import { NavigationContext } from "./navigation";
import { newConversationUrl } from "./new-conversation-project";
import { STATUS_PILL } from "./status-pill";

/**
 * How long the merge waiting longest for the premerge lock has waited, since
 * it was asked for. It opens the merges under way, the one merging first,
 * then those waiting, longest first, each timed from when it was asked
 * for, its wait included, and each a way to its conversation. Muted
 * whatever the wait, since it asks nothing of you, and gone while none
 * waits, a merge alone under way included.
 */
export function MergeBadge({
	snapshot,
}: {
	snapshot: Snapshot | null;
}): JSX.Element | null {
	const navigation = useContext(NavigationContext);
	const [open, setOpen] = useState(false);
	const merges = (snapshot?.tasks ?? [])
		.flatMap((task) =>
			task.gate !== null && task.mergeSince !== null
				? [
						{
							task: task.task,
							conversation:
								task.takenBy ?? task.caller ?? `${TASK}${task.task}`,
							running: task.gate === "running" || task.status === "merging",
							since: Date.parse(task.mergeSince),
						},
					]
				: [],
		)
		.sort(
			(one, other) =>
				Number(other.running) - Number(one.running) || one.since - other.since,
		);
	const waiting = merges.filter((merge) => !merge.running);
	const now = useNow(waiting.length > 0, Duration.secs(15));
	const longest = waiting[0];
	if (snapshot === null || longest === undefined) {
		return null;
	}
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				title="How long the merge waiting longest for its turn has waited"
				className={cn(
					STATUS_PILL,
					"bg-muted text-muted-foreground tabular-nums",
				)}
			>
				<GitMergeIcon />
				{minutes(now - longest.since)}
			</PopoverTrigger>
			<PopoverContent align="start" className="w-72 gap-1 p-2">
				<p className="px-2 pt-1 pb-1 font-medium text-muted-foreground text-xs">
					Merges
				</p>
				<ol aria-label="Merges" className="flex flex-col">
					{merges.map((merge) => (
						<li key={merge.task}>
							<button
								type="button"
								onClick={() => {
									setOpen(false);
									navigation.show(
										newConversationUrl(snapshot.project, merge.conversation),
									);
								}}
								className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted"
							>
								<span className="flex w-4 shrink-0 justify-center text-muted-foreground text-xs tabular-nums">
									{merge.running ? (
										// As the sidebar and inbox mark a merge testing and landing.
										<GitMergeIcon
											aria-label="merging"
											className="size-3.5 animate-pulse text-success motion-reduce:animate-none"
										/>
									) : (
										waiting.indexOf(merge) + 1
									)}
								</span>
								<span className="min-w-0 flex-1 truncate">{merge.task}</span>
								<span className="shrink-0 text-muted-foreground text-xs tabular-nums">
									{minutes(now - merge.since)}
								</span>
							</button>
						</li>
					))}
				</ol>
			</PopoverContent>
		</Popover>
	);
}

/** `elapsed` ms as `<1m`, `4m` or `1h 5m`. */
function minutes(elapsed: number): string {
	const mins = Math.floor(elapsed / Duration.mins(1).ms);
	if (mins < 1) {
		return "<1m";
	}
	return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
}
