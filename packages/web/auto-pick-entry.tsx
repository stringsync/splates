import type { TaskRecord } from "@stringsync/splates-server/board/browser";
import type { Details } from "@stringsync/splates-server/tasks";
import type { JSX } from "react";
import { cn } from "#web/lib/utils.ts";
import { AutoPickMark } from "./auto-pick-page";
import { autoPickRuns } from "./auto-pick-runs";
import { AUTO_PICK_PAGE } from "./conversation-address";

/**
 * Auto pick's row, under the groomer's: its amber mark, and what it last
 * picked, opening Auto pick's page. It lists no more than the page's tasks
 * keep, so it shows once a task has been picked for.
 */
export function AutoPickEntry({
	tasks,
	todos,
	open,
	onOpen,
	phone = false,
}: {
	tasks: readonly Details[];
	todos: readonly TaskRecord[];
	open: string | null;
	onOpen: (id: string) => void;
	/** Whether it is a row of the phone's inbox, with its bigger touch target. */
	phone?: boolean;
}): JSX.Element | null {
	const last = autoPickRuns(tasks, todos)[0];
	if (last === undefined) {
		return null;
	}
	return (
		<button
			type="button"
			data-row
			aria-current={open === AUTO_PICK_PAGE ? "page" : undefined}
			onClick={() => onOpen(AUTO_PICK_PAGE)}
			className={cn(
				"flex w-full items-center gap-2.5 rounded-md px-3 text-left hover:bg-accent",
				phone ? "min-h-16 gap-3 rounded-none px-4" : "py-1.5",
				open === AUTO_PICK_PAGE && "bg-accent",
			)}
		>
			<AutoPickMark className={phone ? "size-10 rounded-full" : "size-6"} />
			<span className="flex min-w-0 flex-1 flex-col">
				<span className="flex items-center gap-1.5">
					<span className="truncate font-medium text-sm">Auto pick</span>
					<span className="shrink-0 rounded-sm bg-amber-500/15 px-1.5 py-px font-medium text-[10px] text-amber-700 uppercase leading-4 tracking-wide dark:text-amber-300">
						Automation
					</span>
				</span>
				<span className="truncate text-muted-foreground text-xs">
					{last.picked.reasons[0]}
				</span>
			</span>
		</button>
	);
}
