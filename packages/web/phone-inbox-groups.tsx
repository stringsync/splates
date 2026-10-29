import type { Needing } from "@stringsync/splates-server/plans";
import { ChevronRightIcon, PlusIcon } from "lucide-react";
import { Fragment, type JSX, type ReactNode } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { cn } from "#web/lib/utils.ts";
import { openedBy } from "./conversation-address";
import { type AgentChoice, agentName } from "./conversation-feed";
import { InConversationProject } from "./conversation-project";
import { hostsAtWork } from "./conversation-rows";
import type { Nested } from "./parts";
import { Row } from "./phone-inbox-row";
import { ProjectEmpty } from "./project-controls";
import { InLanes } from "./project-folder-list";
import type { Folder } from "./project-folders";
import { Placing, placesOf } from "./reparent";

/** A tree to list, with the folder it is of; null while the inbox is not in folders. */
export interface Item {
	tree: Nested<Needing>;
	folder: Folder | null;
	/** Conversations with a subagent at work, scoped to the folder when present. */
	hosting?: Set<string>;
}

/**
 * A heading and its rows, each agent's subagents under it, and what
 * `beneath` puts under each, or nothing when it has none. The count is of the
 * agents at the top.
 */
export function Group({
	title,
	items,
	agents,
	urgent = false,
	beneath,
	onOpen,
}: {
	agents: AgentChoice[];
	title: string;
	items: Item[];
	urgent?: boolean;
	/** The rows under an agent's, a level deeper than `depth`, its own. */
	beneath: (row: Needing, depth: number) => ReactNode[];
	onOpen: (row: Needing, folder: Folder | null) => void;
}): ReactNode {
	if (items.length === 0) {
		return null;
	}
	return (
		<section aria-label={title} className="pt-4">
			<h2
				className={cn(
					"px-4 pb-1 font-medium text-muted-foreground text-xs uppercase tracking-wide",
					urgent && "text-warning",
				)}
			>
				{title} · {items.length}
			</h2>
			<Lines items={items} agents={agents} beneath={beneath} onOpen={onOpen} />
		</section>
	);
}

/**
 * A project's folder: its name, which folds it away as this browser keeps
 * it, how many agents wait on you there, a + to start a conversation in it
 * and a ⋯ for its menu, which a long press on its name opens too, none of
 * them waiting on a hover; then its agents, those waiting on you first.
 */
export function ProjectSection({
	folder,
	open,
	onFold,
	onNew,
	agents,
	beneath,
	onOpen,
}: {
	folder: Folder;
	/** Whether it is unfolded. */
	open: boolean;
	onFold: (open: boolean) => void;
	/** Null while no conversation can start. */
	onNew: (() => void) | null;
	agents: AgentChoice[];
	beneath: (row: Needing, depth: number) => ReactNode[];
	onOpen: (row: Needing, folder: Folder | null) => void;
}): JSX.Element {
	const items = folder.listed.map((tree) => ({ tree, folder }));
	return (
		<section aria-label={folder.name} className="flex flex-col pt-4">
			<div className="flex items-center pr-2">
				<h2 className="flex min-w-0 flex-1">
					<button
						type="button"
						aria-expanded={open}
						onClick={() => onFold(!open)}
						className={cn(
							"flex min-h-10 min-w-0 flex-1 items-center gap-1.5 px-4 text-left font-medium text-muted-foreground text-xs uppercase tracking-wide",
						)}
					>
						<ChevronRightIcon
							aria-hidden
							className={cn(
								"size-3.5 shrink-0 transition-transform duration-150",
								open && "rotate-90",
							)}
						/>
						<span className="min-w-0 truncate">{folder.name}</span>
					</button>
				</h2>
				{onNew !== null && (
					<Button
						type="button"
						variant="ghost"
						size="icon"
						aria-label={`New conversation in ${folder.name}`}
						onClick={onNew}
						className="size-11"
					>
						<PlusIcon />
					</Button>
				)}
			</div>
			{open && folder.trees.length === 0 && <ProjectEmpty />}
			{open && items.length > 0 && (
				<Lines
					items={items}
					agents={agents}
					beneath={beneath}
					onOpen={onOpen}
				/>
			)}
		</section>
	);
}

/** The rows of `items`, each tree's subagents under it. */
function Lines({
	items,
	agents,
	beneath,
	onOpen,
}: {
	items: Item[];
	agents: AgentChoice[];
	beneath: (row: Needing, depth: number) => ReactNode[];
	onOpen: (row: Needing, folder: Folder | null) => void;
}): ReactNode {
	// A folder's reads the rows it leaves out too, a subagent's at work among them.
	const hosting = new Set(
		items.flatMap(({ tree, folder, hosting }) => [
			...(folder?.hosting ?? hosting ?? hostsAtWork([tree])),
		]),
	);
	const lines = (
		trees: Nested<Needing>[],
		depth: number,
	): { row: Needing; depth: number }[] =>
		trees.flatMap(({ row, parts }) => [
			{ row, depth },
			...lines(parts, depth + 1),
		]);
	const line = ({ tree, folder }: Item) => (
		<InFolder
			key={`${folder?.project ?? ""} ${openedBy(tree.row)}`}
			folder={folder}
		>
			<ul>
				{lines([tree], 0).map(({ row, depth }) => (
					<Fragment key={openedBy(row)}>
						<li>
							<Row
								row={row}
								depth={depth}
								agent={
									row.conversation === null
										? null
										: agentName(agents, row.conversation.agent)
								}
								hosting={
									row.conversation !== null && hosting.has(row.conversation.id)
								}
								onOpen={() => onOpen(row, folder)}
							/>
						</li>
						{folder === null || folder.here ? beneath(row, depth + 1) : []}
					</Fragment>
				))}
			</ul>
		</InFolder>
	);
	return items.map(line);
}

function InFolder({
	folder,
	children,
}: {
	folder: Folder | null;
	children: ReactNode;
}): ReactNode {
	if (folder === null) {
		return children;
	}
	const named = <InLanes folder={folder}>{children}</InLanes>;
	return folder.here || folder.project === null ? (
		named
	) : (
		<InConversationProject
			project={folder.project}
			tasks={folder.tasks}
			conversations={folder.conversations}
		>
			<Placing
				value={{
					places: placesOf(folder.trees),
					agentOf: (conversation) => conversation.agent,
				}}
			>
				{named}
			</Placing>
		</InConversationProject>
	);
}
