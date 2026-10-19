import type { Needing } from "@stringsync/splates-server/plans";
import { ChevronRightIcon, PlusIcon } from "lucide-react";
import { Fragment, type JSX, type ReactNode } from "react";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#web/components/ui/collapsible.tsx";
import { cn } from "#web/lib/utils.ts";
import { openedBy } from "./conversation-address";
import { type AgentChoice, agentName } from "./conversation-feed";
import { hostsAtWork } from "./conversation-rows";
import type { Nested } from "./parts";
import { Row } from "./phone-inbox-row";
import { InLanes } from "./project-folder-list";
import type { Folder } from "./project-folders";

/** A tree to list, with the folder it is of; null while the inbox is not in folders. */
export interface Item {
	tree: Nested<Needing>;
	folder: Folder | null;
	/**
	 * The conversations with a subagent at work under them, as `hostsAtWork`
	 * reads every row; a folder's own when it has one.
	 */
	hosting?: Set<string>;
}

/**
 * A heading and its rows, each agent's subagents under it, and what
 * `beneath` puts under each, or nothing when it has none. The count is of the
 * agents at the top. `named` has each row say which project it is in.
 */
export function Group({
	title,
	items,
	agents,
	urgent = false,
	named = false,
	beneath,
	onOpen,
}: {
	agents: AgentChoice[];
	title: string;
	items: Item[];
	urgent?: boolean;
	named?: boolean;
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
			<Lines
				items={items}
				agents={agents}
				named={named}
				beneath={beneath}
				onOpen={onOpen}
			/>
		</section>
	);
}

/**
 * A project's folder: its name, a dot while folded with an agent of its
 * waiting, and a + to start a conversation in it, then its agents at work and
 * the rest. Another project's rows have no menu.
 */
export function FolderSection({
	folder,
	open,
	onFold,
	onNew,
	agents,
	beneath,
	onOpen,
}: {
	folder: Folder;
	open: boolean;
	onFold: (open: boolean) => void;
	/** Null while no conversation can start. */
	onNew: (() => void) | null;
	agents: AgentChoice[];
	beneath: (row: Needing, depth: number) => ReactNode[];
	onOpen: (row: Needing, folder: Folder | null) => void;
}): JSX.Element {
	const items = folder.listed.map((tree) => ({
		tree,
		folder,
	}));
	return (
		<Collapsible
			open={open}
			onOpenChange={onFold}
			render={<section aria-label={folder.name} />}
			className="group/folder flex flex-col pt-4"
		>
			<div className="flex items-center pr-2">
				<CollapsibleTrigger className="flex min-h-10 min-w-0 flex-1 items-center gap-1.5 px-4 font-medium text-muted-foreground text-xs uppercase tracking-wide outline-none">
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
				{onNew !== null && (
					<button
						type="button"
						aria-label={`New conversation in ${folder.name}`}
						onClick={onNew}
						className="flex size-10 shrink-0 items-center justify-center text-muted-foreground active:bg-muted"
					>
						<PlusIcon className="size-4" />
					</button>
				)}
			</div>
			<CollapsibleContent>
				{items.length > 0 && (
					<Lines
						items={items}
						agents={agents}
						named={false}
						beneath={folder.here ? beneath : () => []}
						onOpen={onOpen}
					/>
				)}
			</CollapsibleContent>
		</Collapsible>
	);
}

/** The rows of `items`, each tree's subagents under it. */
function Lines({
	items,
	agents,
	named,
	beneath,
	onOpen,
}: {
	items: Item[];
	agents: AgentChoice[];
	named: boolean;
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
	return (
		<>
			{items.map(({ tree, folder }) => (
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
											row.conversation !== null &&
											hosting.has(row.conversation.id)
										}
										project={named && folder !== null ? folder.name : null}
										foreign={folder !== null && !folder.here}
										onOpen={() => onOpen(row, folder)}
									/>
								</li>
								{folder === null || folder.here ? beneath(row, depth + 1) : []}
							</Fragment>
						))}
					</ul>
				</InFolder>
			))}
		</>
	);
}

function InFolder({
	folder,
	children,
}: {
	folder: Folder | null;
	children: ReactNode;
}): ReactNode {
	return folder === null ? (
		children
	) : (
		<InLanes folder={folder}>{children}</InLanes>
	);
}
