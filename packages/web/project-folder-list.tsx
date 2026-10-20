import type { Needing } from "@stringsync/splates-server/plans";
import { ChevronRightIcon, PlusIcon } from "lucide-react";
import type { JSX, ReactNode } from "react";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#web/components/ui/collapsible.tsx";
import { Kbd } from "#web/components/ui/kbd.tsx";
import { cn } from "#web/lib/utils.ts";
import { AutomationTag, RowIcon } from "./agent-icons";
import { Lanes, reportedAs, unnamed, useNameOf } from "./conversation-names";
import { placeholding } from "./conversation-rows";
import type { LaneGroup } from "./lane-groups";
import { LaneRows } from "./lane-rows";
import { Rows } from "./list-rows";
import { Mark } from "./mark";
import { type Folder, folderKey } from "./project-folders";
import { TaskIcon } from "./task-icon";

/** Draws a row of `folder`'s. */
export type RenderRow = (
	folder: Folder,
	row: Needing,
	nested: boolean,
) => ReactNode;

/**
 * A folder per project, by name, its persistent agents kept atop it, set
 * apart by a rule, then its agents at work, then the rest, those on one
 * lane's tasks together under its title, those waiting on
 * you left in place, their marks turned yellow. Each folds away, as this browser
 * keeps it, showing a dot while folded with an agent of its waiting, and its
 * "+" starts a conversation in it. Quiet: a name, a dot, and its rows.
 */
export function FolderList({
	folders,
	folded,
	onFold,
	onNew,
	render,
	beneath,
	groupsOf,
	onLane,
}: {
	folders: Folder[];
	folded: ReadonlySet<string>;
	onFold: (key: string, open: boolean) => void;
	onNew: (folder: Folder) => void;
	render: RenderRow;
	beneath: (folder: Folder, row: Needing) => ReactNode[];
	/** The folder's listed rows, those at work on one lane gathered together. */
	groupsOf: (folder: Folder) => LaneGroup[];
	/** Opens lane `lane` of the folder's project on its board. */
	onLane: (folder: Folder, lane: number) => void;
}): JSX.Element {
	return (
		<div className="flex flex-col gap-2">
			{folders.map((folder) => {
				const key = folderKey(folder);
				const open = !folded.has(key);
				const { kept, listed: rows } = folder.inPlace;
				return (
					<Collapsible
						key={key}
						open={open}
						onOpenChange={(open) => onFold(key, open)}
						render={<section aria-label={folder.name} />}
						className="group/folder flex flex-col"
					>
						<div className="group/head flex items-center">
							<CollapsibleTrigger className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 font-medium text-muted-foreground text-xs outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40">
								<ChevronRightIcon
									aria-hidden
									className="size-3.5 shrink-0 transition-transform duration-150 group-data-[open]/folder:rotate-90"
								/>
								<span className="min-w-0 truncate">{folder.name}</span>
								{!open && folder.waiting.length > 0 && (
									<span
										role="img"
										aria-label="waiting on you"
										className="size-1.5 shrink-0 rounded-full bg-warning"
									/>
								)}
							</CollapsibleTrigger>
							<button
								type="button"
								aria-label={`New conversation in ${folder.name}`}
								title={`New conversation in ${folder.name}`}
								onClick={() => onNew(folder)}
								className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 outline-none hover:bg-muted hover:text-foreground active:bg-muted active:text-foreground focus-visible:opacity-100 focus-visible:ring-3 focus-visible:ring-ring/40 group-hover/head:opacity-100 pointer-coarse:opacity-100"
							>
								<PlusIcon className="size-3.5" />
							</button>
						</div>
						<CollapsibleContent>
							{kept.length > 0 && (
								<InLanes folder={folder}>
									<Rows
										label={`${folder.name} persistent agents`}
										rows={kept}
										render={(row, nested) => render(folder, row, nested)}
										beneath={(row) => beneath(folder, row)}
									/>
									{rows.length > 0 && (
										<hr className="mx-3 my-1 border-foreground/10" />
									)}
								</InLanes>
							)}
							{rows.length > 0 && (
								<InLanes folder={folder}>
									<LaneRows
										label={`${folder.name} conversations`}
										groups={groupsOf(folder)}
										render={(row, nested) => render(folder, row, nested)}
										beneath={(row) => beneath(folder, row)}
										onLane={(lane) => onLane(folder, lane)}
									/>
								</InLanes>
							)}
						</CollapsibleContent>
					</Collapsible>
				);
			})}
		</div>
	);
}

/**
 * A row of another project's, which this page holds no actions for: its
 * mark and its name, opening its project's page at it.
 */
export function ForeignItem({
	row,
	agent,
	hint,
	nested,
	onOpen,
}: {
	row: Needing;
	/** Its agent's name; null for an external one. */
	agent: string | null;
	hint: string | null;
	nested: boolean;
	onOpen: () => void;
}): JSX.Element {
	const nameOf = useNameOf();
	const { conversation, task, need } = row;
	const name =
		conversation !== null ? nameOf(conversation) : (task?.task ?? "");
	return (
		<button
			type="button"
			data-row
			onClick={onOpen}
			title={conversation?.task ?? undefined}
			className={cn(
				"flex w-full min-w-0 items-center gap-2 rounded-md py-1.5 pr-2 pl-3 text-left text-foreground hover:bg-foreground/[0.05] active:bg-foreground/[0.08]",
				conversation !== null && placeholding(conversation) && "opacity-50",
			)}
		>
			{conversation !== null && agent !== null ? (
				<RowIcon
					conversation={conversation}
					name={agent}
					className="size-3.5 text-foreground/70"
				/>
			) : (
				<TaskIcon className="size-3.5 shrink-0 text-foreground/70" />
			)}
			<span className="flex min-w-0 flex-1 items-center gap-1.5">
				<span
					className={cn(
						"min-w-0 truncate text-sm",
						(nested ||
							(conversation !== null &&
								(unnamed(conversation) || placeholding(conversation)))) &&
							"text-muted-foreground italic",
					)}
				>
					{name}
				</span>
				{conversation !== null && <AutomationTag conversation={conversation} />}
			</span>
			{hint !== null ? (
				<Kbd aria-hidden>{hint}</Kbd>
			) : (
				<Mark
					need={need}
					reported={conversation === null ? null : reportedAs(conversation)}
					unread={conversation?.unread ?? false}
					subagent={nested}
				/>
			)}
		</button>
	);
}

/** Names `folder`'s lane orchestrators after its lanes, the page's own as its snapshot does. */
export function InLanes({
	folder,
	children,
}: {
	folder: Folder;
	children: ReactNode;
}): ReactNode {
	return folder.laneNames === null ? (
		children
	) : (
		<Lanes value={folder.laneNames}>{children}</Lanes>
	);
}
