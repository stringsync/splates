import type { Needing } from "@stringsync/splates-server/needs";
import { ChevronRightIcon, PlusIcon } from "lucide-react";
import type { JSX, ReactNode } from "react";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#web/components/ui/collapsible.tsx";
import { Kbd } from "#web/components/ui/kbd.tsx";
import { cn } from "#web/lib/utils.ts";
import { AgentIcon } from "./agent-icons";
import { Lanes, reportedAs, unnamed, useNameOf } from "./conversation-names";
import { Rows } from "./list-rows";
import { Mark } from "./mark";
import { type Folder, folderKey, type Placed } from "./project-folders";
import { TaskIcon } from "./task-icon";

/** Draws a row of `folder`'s; `named` when it should say which project it is in. */
export type RenderRow = (
	folder: Folder,
	row: Needing,
	nested: boolean,
	named: boolean,
) => ReactNode;

/**
 * Every agent waiting on you, whatever its project, each row naming the
 * project it is in. Nothing while none waits.
 */
export function NeedsYou({
	placed,
	render,
	beneath,
}: {
	placed: Placed[];
	render: RenderRow;
	beneath: (folder: Folder, row: Needing) => ReactNode[];
}): ReactNode {
	if (placed.length === 0) {
		return null;
	}
	return (
		<section aria-label="Needs you" className="flex flex-col">
			<h2 className="px-3 pb-1 font-medium text-warning text-xs">Needs you</h2>
			{placed.map(({ folder, tree }) => (
				<InLanes key={keyOf(folder, tree.row)} folder={folder}>
					<Rows
						label={`needs you in ${folder.name}`}
						rows={[tree]}
						render={(row, nested) => render(folder, row, nested, true)}
						beneath={(row) => beneath(folder, row)}
					/>
				</InLanes>
			))}
		</section>
	);
}

/**
 * A folder per project, by name, its agents at work first, then the rest,
 * those waiting on you up in Needs you. Each folds away, as this browser
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
}: {
	folders: Folder[];
	folded: ReadonlySet<string>;
	onFold: (key: string, open: boolean) => void;
	onNew: (folder: Folder) => void;
	render: RenderRow;
	beneath: (folder: Folder, row: Needing) => ReactNode[];
}): JSX.Element {
	return (
		<div className="flex flex-col gap-2">
			{folders.map((folder) => {
				const key = folderKey(folder);
				const open = !folded.has(key);
				const rows = [...folder.working, ...folder.recent];
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
								className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 outline-none hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:ring-3 focus-visible:ring-ring/40 group-hover/head:opacity-100 pointer-coarse:opacity-100"
							>
								<PlusIcon className="size-3.5" />
							</button>
						</div>
						<CollapsibleContent>
							{rows.length > 0 && (
								<InLanes folder={folder}>
									<Rows
										label={`${folder.name} conversations`}
										rows={rows}
										render={(row, nested) => render(folder, row, nested, false)}
										beneath={(row) => beneath(folder, row)}
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
	project,
	hint,
	nested,
	onOpen,
}: {
	row: Needing;
	/** Its agent's name; null for an external one. */
	agent: string | null;
	/** The project to name after it, or null to name none. */
	project: string | null;
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
			className="flex w-full min-w-0 items-center gap-2 rounded-md py-1.5 pr-2 pl-3 text-left text-foreground hover:bg-foreground/[0.05]"
		>
			{conversation !== null && agent !== null ? (
				<AgentIcon
					agent={conversation.agent}
					name={agent}
					className="size-3.5 text-foreground/70"
				/>
			) : (
				<TaskIcon className="size-3.5 shrink-0 text-foreground/70" />
			)}
			<span
				className={cn(
					"min-w-0 flex-1 truncate text-sm",
					(nested || (conversation !== null && unnamed(conversation))) &&
						"text-muted-foreground italic",
				)}
			>
				{name}
			</span>
			{project !== null && (
				<span className="max-w-[40%] shrink-0 truncate text-muted-foreground text-xs">
					{project}
				</span>
			)}
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

function keyOf(folder: Folder, row: Needing): string {
	return `${folderKey(folder)} ${row.conversation?.id ?? row.task?.task ?? ""}`;
}
