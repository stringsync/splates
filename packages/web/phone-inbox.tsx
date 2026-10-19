import type { Needing } from "@stringsync/splates-server/plans";
import type { Details } from "@stringsync/splates-server/tasks";
import { useReactive } from "@webappwiz/react";
import {
	ArchiveIcon,
	ChevronRightIcon,
	MenuIcon,
	PlusIcon,
	SquarePenIcon,
} from "lucide-react";
import { Fragment, type JSX, type ReactNode, useContext } from "react";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#web/components/ui/collapsible.tsx";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
} from "#web/components/ui/empty.tsx";
import { Skeleton } from "#web/components/ui/skeleton.tsx";
import { cn } from "#web/lib/utils.ts";
import { AgentIcon } from "./agent-icons";
import { ARCHIVED, NEW, openedBy } from "./conversation-address";
import {
	type AgentChoice,
	agentName,
	type ConversationFeed,
} from "./conversation-feed";
import {
	flatten,
	hostsAtWork,
	isHostOf,
	rowsOf,
	waitsOnYou,
} from "./conversation-rows";
import type { Drafts } from "./drafts";
import { useEverywhere } from "./everywhere-context";
import { useFolded } from "./folded";
import { NavigationContext } from "./navigation";
import { newConversationUrl, useOpenNew } from "./new-conversation-project";
import { type Nested, nest } from "./parts";
import { launch } from "./phone-home";
import { Row } from "./phone-inbox-row";
import { TerminalGroup, useShells } from "./phone-inbox-shells";
import { InLanes } from "./project-folder-list";
import {
	FOLDED_FOLDERS,
	type Folder,
	folderKey,
	foldersOf,
} from "./project-folders";
import { Placing, placesOf } from "./reparent";
import { arriveAt, useCopiedReplies } from "./task-view";
import type { Terminals } from "./terminals";
import { BarButton, TopBar } from "./top-bar";

/**
 * The phone's home: every agent, sorted by what it asks of you. Those waiting
 * on you come first, then those at work, then the rest, newest first in each,
 * each row a finger's height saying what it waits on. The agents one handed
 * out, its subagents and parts, sit under it, in its group, since they answer
 * to it rather than to you. A tap on one waiting goes straight to what it
 * asks, a long press offers Rename, Mark as unread and Archive, and a swipe
 * left archives it, asking first as Archive does. The menu opens the drawer to switch projects, and the pen, like the composer
 * along the bottom, starts a new conversation. Under each conversation, as in
 * the sidebar, sit its terminal while its shell is up and each command its
 * agent left running, each opening the conversation with it on the screen.
 * The main tree's terminals come last, to go back to or close.
 *
 * With the feed of every project to be had, the groups are the sidebar's: those
 * waiting on you, whatever their project, in Needs you on top, each naming its
 * project, then a folder per project, its agents at work first. A folder folds
 * away as the sidebar's does, dotted while folded with one waiting, and its +
 * starts a conversation there. Another project's row only opens, by switching
 * the page to that project.
 *
 * Beside a sidebar, `onMenu` null, it is the page the sidebar's Inbox opens:
 * under the shell's bar, with no menu and no composer along the bottom, the
 * sidebar having New, and the archived conversations at its foot, as the
 * drawer has them on a phone.
 */
export function Inbox({
	feed,
	drafts,
	terminals,
	tasks,
	here,
	status,
	loading,
	onMenu,
	onOpen,
}: {
	feed: ConversationFeed;
	/** Where a reply copied for an external agent is kept. */
	drafts: Drafts;
	terminals: Terminals;
	tasks: Details[];
	/** The project the page shows, as its snapshot has it; null before it comes. */
	here: { root: string; repo: string; trunk: string | null } | null;
	/** Whether the server is offline or outdated, shown in the header. */
	status: ReactNode;
	/** Whether the project snapshot is still on its way. */
	loading: boolean;
	/** Opens the phone's drawer; null beside a sidebar. */
	onMenu: (() => void) | null;
	onOpen: (id: string) => void;
}): JSX.Element {
	const { agents, conversations, pending, available } = useReactive(
		feed,
		(feed) => ({
			agents: feed.agents,
			conversations: feed.conversations,
			pending: feed.loading,
			available: feed.available,
		}),
		["changed"],
	);
	const { mains, beneath, close, confirm } = useShells(terminals, onOpen);
	// In the project the last one started in, which may be another's page.
	const openNew = useOpenNew(onOpen);
	useCopiedReplies(drafts);
	const rows = rowsOf(tasks, conversations);
	// Each with the agents it handed out, in the group of the most pressing.
	const trees = nest(rows, (host, part) => isHostOf(tasks, host, part));
	const waiting = trees.filter((tree) =>
		flatten([tree]).some((row) => waitsOnYou(row, drafts, conversations)),
	);
	const working = trees.filter(
		(tree) =>
			!waiting.includes(tree) &&
			flatten([tree]).some(
				(row) => row.need.kind === "working" || row.need.kind === "assuming",
			),
	);
	const rest = trees.filter(
		(tree) => !waiting.includes(tree) && !working.includes(tree),
	);
	const everywhere = useEverywhere(
		({ available, projects, tasks, conversations }) => ({
			available,
			projects,
			tasks,
			conversations,
		}),
	);
	const grouped =
		everywhere.available && here !== null
			? foldersOf(
					everywhere.projects,
					everywhere.tasks,
					everywhere.conversations,
					{ ...here, tasks, conversations },
					drafts,
				)
			: null;
	const { folded, fold } = useFolded(FOLDED_FOLDERS);
	const navigation = useContext(NavigationContext);
	const open = (row: Needing, folder: Folder | null) => {
		if (folder !== null && !folder.here && folder.project !== null) {
			navigation.show(newConversationUrl(folder.project, openedBy(row)));
			return;
		}
		if (waitsOnYou(row, drafts, conversations)) {
			arriveAt(openedBy(row));
		}
		onOpen(openedBy(row));
	};
	const startIn = (folder: Folder) => {
		if (folder.here || folder.project === null) {
			onOpen(NEW);
		} else {
			navigation.show(newConversationUrl(folder.project));
		}
	};
	const empty =
		grouped === null
			? rows.length === 0
			: grouped.folders.every((each) => each.trees.length === 0);
	const agent = agents.find((each) => each.id === "claude") ?? agents[0];
	const wide = onMenu === null;
	const archived = conversations.filter((each) => each.archived).length;
	return (
		<section
			aria-label="inbox"
			className={cn(
				"flex flex-col bg-background",
				wide ? "mx-auto w-full max-w-3xl" : "min-h-dvh",
			)}
		>
			<TopBar
				className="sticky top-0 z-10 box-content border-b bg-background/95 pt-[env(safe-area-inset-top)] backdrop-blur"
				leading={
					onMenu !== null && (
						<BarButton label="Open menu" onClick={onMenu}>
							<MenuIcon />
						</BarButton>
					)
				}
				title={wide ? "Inbox" : status}
				actions={[
					{
						label: "New conversation",
						icon: <SquarePenIcon />,
						run: () => {
							if (available) {
								openNew();
							}
						},
					},
				]}
			/>
			<div className={cn("flex flex-1 flex-col", wide ? "pb-6" : "pb-28")}>
				{loading || pending ? (
					<div
						role="status"
						aria-label="Loading inbox"
						className="flex flex-col gap-3 p-6"
					>
						<span className="sr-only">Loading inbox…</span>
						<Skeleton className="h-16 w-full" />
						<Skeleton className="h-16 w-full" />
					</div>
				) : empty && mains.length === 0 ? (
					<Empty className="py-16">
						<EmptyHeader>
							<EmptyDescription>
								{available
									? "No conversations yet. Start one below."
									: "No conversations yet."}
							</EmptyDescription>
						</EmptyHeader>
					</Empty>
				) : (
					<Placing
						value={{
							places: placesOf(trees),
							agentOf: (each) => agentName(agents, each.agent),
						}}
					>
						{grouped === null ? (
							[
								["Needs you", waiting],
								["Working", working],
								["Recent", rest],
							].map(([title, group]) => (
								<Group
									key={String(title)}
									title={String(title)}
									items={(group as Nested<Needing>[]).map((tree) => ({
										tree,
										folder: null,
									}))}
									agents={agents}
									drafts={drafts}
									urgent={title === "Needs you"}
									beneath={beneath}
									onOpen={open}
								/>
							))
						) : (
							<>
								<Group
									title="Needs you"
									items={grouped.needsYou}
									agents={agents}
									drafts={drafts}
									urgent
									named
									beneath={beneath}
									onOpen={open}
								/>
								{grouped.folders.map((folder) => (
									<FolderSection
										key={folderKey(folder)}
										folder={folder}
										open={!folded.has(folderKey(folder))}
										onFold={(open) => fold(folderKey(folder), open)}
										onNew={available ? () => startIn(folder) : null}
										agents={agents}
										drafts={drafts}
										beneath={beneath}
										onOpen={open}
									/>
								))}
							</>
						)}
						<TerminalGroup
							mains={mains}
							nameOf={(key) => terminals.nameOf(key)}
							onRename={(key, name) => terminals.rename(key, name)}
							onOpen={onOpen}
							onClose={close}
						/>
					</Placing>
				)}
				{wide && available && (
					<button
						type="button"
						onClick={() => onOpen(ARCHIVED)}
						className="mx-4 mt-6 flex items-center gap-2 self-start rounded-md px-3 py-1.5 text-muted-foreground text-xs hover:bg-muted"
					>
						<ArchiveIcon className="size-3.5" />
						<span>Archived</span>
						{archived > 0 && <span className="tabular-nums">{archived}</span>}
					</button>
				)}
			</div>
			{/* Where a thumb is, as the chat apps keep their composer. */}
			{!wide && (
				<div className="fixed inset-x-0 bottom-0 z-10 bg-gradient-to-t from-background via-background to-transparent px-4 pt-6 pb-[max(1rem,env(safe-area-inset-bottom))]">
					{/* A field rather than a button, so a tap raises the keyboard,
				    which the new conversation's composer takes over. */}
					<label className="flex h-12 w-full items-center gap-3 rounded-full border bg-card px-4 text-muted-foreground shadow-sm">
						{agent !== undefined && (
							<AgentIcon
								agent={agent.id}
								name={agent.name}
								className="size-4 shrink-0 text-foreground/70"
							/>
						)}
						<input
							aria-label="Start a conversation"
							placeholder={`Ask ${agent?.name ?? "an agent"} to work on something`}
							disabled={!available}
							onFocus={() => {
								launch();
								openNew();
							}}
							className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
						/>
					</label>
				</div>
			)}
			{confirm}
		</section>
	);
}

/** A tree to list, with the folder it is of; null while the inbox is not in folders. */
interface Item {
	tree: Nested<Needing>;
	folder: Folder | null;
}

/**
 * A heading and its rows, each agent's subagents under it, and what
 * `beneath` puts under each, or nothing when it has none. The count is of the
 * agents at the top. `named` has each row say which project it is in.
 */
function Group({
	title,
	items,
	agents,
	drafts,
	urgent = false,
	named = false,
	beneath,
	onOpen,
}: {
	agents: AgentChoice[];
	drafts: Drafts;
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
				drafts={drafts}
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
function FolderSection({
	folder,
	open,
	onFold,
	onNew,
	agents,
	drafts,
	beneath,
	onOpen,
}: {
	folder: Folder;
	open: boolean;
	onFold: (open: boolean) => void;
	/** Null while no conversation can start. */
	onNew: (() => void) | null;
	agents: AgentChoice[];
	drafts: Drafts;
	beneath: (row: Needing, depth: number) => ReactNode[];
	onOpen: (row: Needing, folder: Folder | null) => void;
}): JSX.Element {
	const items = [...folder.working, ...folder.recent].map((tree) => ({
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
						drafts={drafts}
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
	drafts,
	named,
	beneath,
	onOpen,
}: {
	items: Item[];
	agents: AgentChoice[];
	drafts: Drafts;
	named: boolean;
	beneath: (row: Needing, depth: number) => ReactNode[];
	onOpen: (row: Needing, folder: Folder | null) => void;
}): ReactNode {
	const hosting = hostsAtWork(items.map(({ tree }) => tree));
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
										drafts={drafts}
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
