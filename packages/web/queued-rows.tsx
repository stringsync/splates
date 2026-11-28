import { CircleAlertIcon, HourglassIcon } from "lucide-react";
import type { JSX, ReactNode } from "react";
import { cn } from "#web/lib/utils.ts";
import { queuedAddress } from "./conversation-address";
import { BlockerPill } from "./conversation-item";
import { type Folder, folderKey, type Queued } from "./project-folders";
import { QueueBlockersIcon } from "./queue-blockers";
import {
	type BlockerSource,
	blockerRowKey,
	type HighlightedBlockers,
} from "./sidebar-blockers";
import { QueueToggle } from "./todo-queue";

/**
 * A folder's queued tasks under its agents: what waits for an agent, and what
 * is blocked from getting one. Click a row to open the task; the icon buttons
 * beside it unqueue it or clear what blocks it.
 */
export function QueuedRows({
	folder,
	phone = false,
	open = null,
	highlights,
	onHoverChange,
	onOpen,
}: {
	folder: Folder;
	/** Opens a queued task's page, at its address. */
	onOpen: (address: string) => void;
	/** Drawn for the phone's inbox, with taller rows. */
	phone?: boolean;
	/** The conversation or queued address open in the desktop sidebar, if any. */
	open?: string | null;
	/** Active blocker highlights in the desktop sidebar. */
	highlights?: HighlightedBlockers;
	/** Reports pointer hover over a queued row in the desktop sidebar. */
	onHoverChange?: (source: BlockerSource, hovered: boolean) => void;
}): JSX.Element | null {
	if (folder.queue.length === 0) {
		return null;
	}
	const key = folderKey(folder);
	return (
		<ul aria-label={`${folder.name} queue`} className="flex flex-col">
			{folder.queue.map((queued, place) => {
				const errored =
					queued.todo.closesOn === undefined &&
					queued.blockedBy === null &&
					folder.queueError !== null;
				const line = errored
					? `Queue error: ${folder.queueError}`
					: status(queued, place);
				const address = queuedAddress(queued.todo.id);
				const current = !phone && folder.here && open === address;
				const blockerId = phone
					? null
					: (highlights?.queued.get(blockerRowKey(key, queued.todo.id)) ??
						null);
				const activeSource =
					!phone &&
					highlights?.source?.kind === "queued" &&
					highlights.source.folder === key &&
					highlights.source.todoId === queued.todo.id;
				const source: BlockerSource = {
					kind: "queued",
					folder: key,
					todoId: queued.todo.id,
				};
				return (
					<li
						key={queued.todo.id}
						data-blocker-id={blockerId ?? undefined}
						onMouseEnter={
							phone || onHoverChange === undefined
								? undefined
								: () => onHoverChange(source, true)
						}
						onMouseLeave={
							phone || onHoverChange === undefined
								? undefined
								: () => onHoverChange(source, false)
						}
						className={cn(
							"group flex items-center rounded-md hover:bg-foreground/[0.05] active:bg-foreground/[0.08]",
							phone ? "pr-2" : "pr-1",
							current && "bg-accent hover:bg-accent active:bg-accent",
						)}
					>
						<button
							type="button"
							data-row
							aria-current={current ? "page" : undefined}
							title={line}
							onClick={() => onOpen(address)}
							className={cn(
								"flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-2 pl-3 text-left text-muted-foreground",
								phone && "min-h-16 gap-3 py-2.5 pr-2 pl-4",
							)}
						>
							<span
								className={cn(
									"flex shrink-0 items-center justify-center rounded-full",
									phone ? "size-10" : "size-7",
									errored ? "bg-destructive/15 text-destructive" : "bg-muted",
								)}
							>
								{/* Alert icon when the queue errored; hourglass while waiting for an agent or blockers. */}
								{errored ? (
									<CircleAlertIcon
										aria-hidden
										className={phone ? "size-5" : "size-4"}
									/>
								) : (
									<HourglassIcon
										aria-hidden
										className={phone ? "size-5" : "size-4"}
									/>
								)}
							</span>
							<span className="flex min-w-0 flex-1 flex-col">
								<span
									className={cn(
										"truncate italic",
										phone ? "text-sm" : "text-[13px]",
									)}
								>
									{queued.todo.subject}
								</span>
								<span
									className={cn(
										"truncate text-xs",
										errored ? "text-destructive" : "italic",
									)}
								>
									{statusNode(
										queued,
										place,
										errored ? line : null,
										activeSource,
									)}
								</span>
							</span>
						</button>
						{blockerId !== null && (
							<BlockerPill id={blockerId} subtle className="mr-1" />
						)}
						<QueueBlockersIcon
							todo={queued.todo}
							chain={queued.unqueued}
							phone={phone}
						/>
						<QueueToggle todo={queued.todo} phone={phone} />
					</li>
				);
			})}
		</ul>
	);
}

/** Where a queued task stands: its place in line, or what it waits on. */
function status(queued: Queued, place: number): string {
	const { blockedBy } = queued;
	if (queued.todo.closesOn !== undefined) {
		return `Closes when ${queued.todo.closesOn.signal} fires`;
	}
	if (blockedBy === null) {
		return `Waiting for an agent · ${place + 1} in line`;
	}
	return blockedBy.length === 0
		? "Waiting on blockers"
		: `Waiting on blockers · ${blockedBy.map((id) => `#${id}`).join(", ")}`;
}

/** Renders the status line, showing matching `#id` pills while this row is the active blocked source. */
function statusNode(
	queued: Queued,
	place: number,
	errorLine: string | null,
	activeSource: boolean,
): ReactNode {
	if (errorLine !== null) {
		return errorLine;
	}
	const { blockedBy } = queued;
	if (
		activeSource &&
		queued.todo.closesOn === undefined &&
		blockedBy !== null &&
		blockedBy.length > 0
	) {
		return (
			<span className="inline-flex min-w-0 items-center gap-1">
				<span className="shrink-0">Waiting on</span>
				{blockedBy.map((id) => (
					<BlockerPill key={id} id={id} />
				))}
			</span>
		);
	}
	return status(queued, place);
}
