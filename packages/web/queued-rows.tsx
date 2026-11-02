import { HourglassIcon } from "lucide-react";
import type { JSX } from "react";
import { cn } from "#web/lib/utils.ts";
import { queuedAddress } from "./conversation-address";
import type { Folder, Queued } from "./project-folders";
import { QueueBlockersIcon } from "./queue-blockers";
import { QueueToggle } from "./todo-queue";

/**
 * A folder's queued tasks under its agents, muted and italic with an
 * hourglass where an agent's mark would be: what waits for an agent, and
 * what is blocked from getting one, so the queue reads at a glance.
 */
export function QueuedRows({
	folder,
	phone = false,
	onOpen,
}: {
	folder: Folder;
	/** Opens a queued task's page, at its address. */
	onOpen: (address: string) => void;
	/** Drawn for the phone's inbox, with taller rows. */
	phone?: boolean;
}): JSX.Element | null {
	if (folder.queue.length === 0) {
		return null;
	}
	return (
		<ul aria-label={`${folder.name} queue`} className="flex flex-col">
			{folder.queue.map((queued, place) => (
				<li key={queued.todo.id} className="group flex items-center">
					<button
						type="button"
						data-row
						title={status(queued, place)}
						onClick={() => onOpen(queuedAddress(queued.todo.id))}
						className={cn(
							"flex min-w-0 flex-1 items-center gap-2 rounded-md py-1.5 pr-2 pl-3 text-left text-muted-foreground hover:bg-foreground/[0.05] active:bg-foreground/[0.08]",
							phone && "gap-3 px-4 py-2.5",
						)}
					>
						<span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted">
							<HourglassIcon aria-hidden className="size-4" />
						</span>
						<span className="flex min-w-0 flex-1 flex-col">
							<span className="truncate text-sm italic">
								{queued.todo.subject}
							</span>
							<span className="truncate text-xs italic">
								{status(queued, place)}
							</span>
						</span>
					</button>
					<QueueToggle todo={queued.todo} />
					<QueueBlockersIcon
						todo={queued.todo}
						chain={queued.unqueued}
						phone={phone}
					/>
				</li>
			))}
		</ul>
	);
}

/** Where a queued task stands: its place in line, or what it waits on. */
function status({ blockedBy }: Queued, place: number): string {
	if (blockedBy === null) {
		return `Waiting for an agent · ${place + 1} in line`;
	}
	return blockedBy.length === 0
		? "Blocked"
		: `Blocked · waits on ${blockedBy.map((id) => `#${id}`).join(", ")}`;
}
