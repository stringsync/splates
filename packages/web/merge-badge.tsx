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
import { MergeQueue, type QueuedMerge } from "./merge-queue";
import { NavigationContext } from "./navigation";
import { newConversationUrl } from "./new-conversation-project";
import { STATUS_PILL } from "./status-pill";

/**
 * How long the merge waiting longest for the premerge lock has waited, since
 * it was asked for. It opens the merges under way, the one merging first,
 * then those waiting, longest first, each timed from when it was asked
 * for, its wait included, and each a way to its conversation. Muted
 * whatever the wait, since it asks nothing of you, and gone while none
 * waits or shares a gate. Confirmed batch members are grouped together.
 */
export function MergeBadge({
	snapshot,
}: {
	snapshot: Snapshot | null;
}): JSX.Element | null {
	const navigation = useContext(NavigationContext);
	const [open, setOpen] = useState(false);
	const queue = new MergeQueue(snapshot);
	const now = useNow(queue.visible, Duration.secs(15));
	if (snapshot === null || !queue.visible) {
		return null;
	}
	const openMerge = (merge: QueuedMerge) => {
		setOpen(false);
		navigation.show(newConversationUrl(snapshot.project, merge.conversation));
	};
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				title={
					queue.waiting.length > 0
						? "How long the merge waiting longest for its turn has waited"
						: "Tasks testing together"
				}
				className={cn(
					STATUS_PILL,
					"bg-muted text-muted-foreground tabular-nums",
				)}
			>
				<GitMergeIcon />
				{minutes(now - queue.since)}
			</PopoverTrigger>
			<PopoverContent align="start" className="w-80 gap-2 p-2">
				<p className="px-2 pt-1 pb-1 font-medium text-muted-foreground text-xs">
					Merges
				</p>
				{queue.batches.map((batch) => (
					<section
						key={batch[0]?.task}
						aria-label="Testing together"
						className="rounded-md border border-success/25 bg-success/5 py-1"
					>
						<p className="flex items-center gap-1.5 px-2 py-1 font-medium text-success text-xs">
							<span aria-hidden className="size-1.5 rounded-full bg-success" />
							Testing together · {batch.length} tasks
						</p>
						<ol aria-label="Tasks testing together" className="flex flex-col">
							{batch.map((merge) => (
								<MergeRow
									key={merge.task}
									merge={merge}
									now={now}
									onOpen={openMerge}
								/>
							))}
						</ol>
					</section>
				))}
				{queue.batches.length > 0 && queue.waiting.length > 0 && (
					<p className="px-2 text-muted-foreground text-xs">
						Waiting for a gate
					</p>
				)}
				<ol aria-label="Merges" className="flex flex-col">
					{queue.separate.map((merge) => (
						<MergeRow
							key={merge.task}
							merge={merge}
							now={now}
							onOpen={openMerge}
						/>
					))}
				</ol>
			</PopoverContent>
		</Popover>
	);
}

/** Each task keeps its own clock and conversation link inside or outside a batch. */
function MergeRow({
	merge,
	now,
	onOpen,
}: {
	merge: QueuedMerge;
	now: number;
	onOpen: (merge: QueuedMerge) => void;
}): JSX.Element {
	return (
		<li>
			<button
				type="button"
				onClick={() => onOpen(merge)}
				className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted"
			>
				<span className="flex w-4 shrink-0 justify-center text-muted-foreground text-xs tabular-nums">
					{merge.running ? (
						<GitMergeIcon
							aria-label="merging"
							className="size-3.5 animate-pulse text-success motion-reduce:animate-none"
						/>
					) : (
						merge.place
					)}
				</span>
				<span className="min-w-0 flex-1 truncate">{merge.task}</span>
				<span className="shrink-0 text-muted-foreground text-xs tabular-nums">
					{minutes(now - merge.since)}
				</span>
			</button>
		</li>
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
