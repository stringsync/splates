import type { TaskRecord } from "@stringsync/splates-server/board";
import { queueOrder } from "@stringsync/splates-server/queue/browser";
import { ChevronRightIcon } from "lucide-react";
import type { JSX } from "react";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#web/components/ui/collapsible.tsx";
import { cn } from "#web/lib/utils.ts";
import { useFolded } from "./folded";
import { PHONE_NAME, PHONE_ROW } from "./phone-rows";

/** Where the Tasks page keeps whether the queue is folded away. */
const FOLDED = "splates.tasks.queue";

/**
 * The queue, as `splates queue list` has it: the queued tasks no agent has
 * taken, in the order workers start them, shown even with none so it is
 * plain that nothing waits. Each opens its card on the board.
 */
export function TaskQueue({
	todos,
	onOpen,
}: {
	todos: readonly TaskRecord[];
	onOpen: (id: number) => void;
}): JSX.Element {
	const { folded, fold } = useFolded(FOLDED);
	const queue = queueOrder(todos);
	return (
		<Collapsible
			open={!folded.has("folded")}
			onOpenChange={(open) => fold("folded", open)}
			render={<section aria-label="queue" />}
			className="group/queue mt-2 flex flex-col"
		>
			<CollapsibleTrigger className="-mx-2 flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 font-medium text-muted-foreground text-xs outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 max-md:min-h-11">
				<ChevronRightIcon
					aria-hidden
					className="size-3.5 transition-transform duration-150 group-data-[open]/queue:rotate-90"
				/>
				Queue
				<span className="tabular-nums">{queue.length}</span>
			</CollapsibleTrigger>
			<CollapsibleContent>
				{queue.length === 0 ? (
					<p className="py-2 text-muted-foreground text-sm">Nothing queued</p>
				) : (
					<ol aria-label="queued tasks" className="flex flex-col">
						{queue.map((todo, place) => (
							<li key={todo.id}>
								<button
									type="button"
									onClick={() => onOpen(todo.id)}
									className={cn(
										"-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-muted",
										PHONE_ROW,
									)}
								>
									<span className="w-5 shrink-0 text-right text-muted-foreground text-xs tabular-nums">
										{place + 1}
									</span>
									<span
										className={cn(
											"min-w-0 flex-1 truncate text-sm",
											PHONE_NAME,
										)}
									>
										{todo.subject}
									</span>
									<span className="shrink-0 text-muted-foreground text-xs tabular-nums">
										#{todo.id}
									</span>
								</button>
							</li>
						))}
					</ol>
				)}
			</CollapsibleContent>
		</Collapsible>
	);
}
