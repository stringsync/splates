import type {
	BoardRecord,
	LaneRecord,
	TaskRecord,
} from "@splates/server/board";
import type { Needing } from "@splates/server/plans";
import type { Details } from "@splates/server/tasks";
import { useReactive } from "core/react";
import { ArchiveIcon, MenuIcon, SquarePenIcon } from "lucide-react";
import { type JSX, type ReactNode, useContext, useMemo } from "react";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
} from "#web/components/ui/empty.tsx";
import { cn } from "#web/lib/utils.ts";
import { arriveAt } from "./arrivals";
import { BoardScope } from "./board-chip";
import { ARCHIVED, NEW, openedBy } from "./conversation-address";
import { agentName, type ConversationFeed } from "./conversation-feed";
import { conversationIndex, useConversationIndex } from "./conversation-index";
import {
	hostsAtWork,
	nestRows,
	rowsOf,
	shownIn,
	waitsOnYou,
} from "./conversation-rows";
import { UnstartedGroup, useUnstarted } from "./draft-rows";
import type { Drafts } from "./drafts";
import { useEverywhere } from "./everywhere-context";
import { useFolded } from "./folded";
import { InboxLoading } from "./freshness";
import { NavigationContext } from "./navigation";
import { newConversationUrl } from "./new-conversation-project";
import { Group, ProjectSection } from "./phone-inbox-groups";
import { TerminalGroup, useShells } from "./phone-inbox-shells";
import {
	FOLDED_FOLDERS,
	type Folder,
	folderKey,
	foldersOf,
} from "./project-folders";
import { useProjectName } from "./project-places";
import { ProjectSwitcher } from "./projects";
import { Placing, placesOf } from "./reparent";
import type { Terminals } from "./terminals";
import { BarButton, TopBar } from "./top-bar";

/**
 * The inbox: every agent listed by what it asks of you, to open, rename, mark
 * unread or archive. Pass `onMenu` to show it
 * as the phone's home, opening the drawer; pass null for the page the
 * sidebar's Inbox opens.
 */
export function Inbox({
	feed,
	drafts,
	terminals,
	tasks,
	todos,
	lanes,
	boards,
	here,
	chips,
	loading,
	onMenu,
	onOpen,
}: {
	feed: ConversationFeed;
	/** Where a reply copied for an external agent is kept. */
	drafts: Drafts;
	terminals: Terminals;
	tasks: Details[];
	todos: TaskRecord[];
	/** The project's lanes and boards, to say which board each task's row is on. */
	lanes: LaneRecord[];
	boards?: BoardRecord[];
	/** The project the page shows, as its snapshot has it; null before it comes. */
	here: {
		root: string;
		repo: string;
		trunk: string | null;
		queueError?: string | null;
	} | null;
	/** The row of the project's pages under a phone's bar. */
	chips?: ReactNode;
	/** Whether the project snapshot is still on its way. */
	loading: boolean;
	/** Opens the phone's drawer; null beside a sidebar. */
	onMenu: (() => void) | null;
	onOpen: (id: string) => void;
}): JSX.Element {
	// Pinned ones come first, then the rest, newest first, each row saying
	// what it waits on, so a row stays put as its agent works. The agents one
	// handed out sit under it, since they answer to it. A tap on
	// one waiting goes straight to what it asks; its action button or a long
	// press offers Rename, Mark as unread and Archive in a bottom sheet.
	// The bar's title switches projects, the pen starts a conversation in the
	// project shown, and `chips` under the bar go to its pages. Under each
	// conversation sit its terminal while its shell is up and each command its
	// agent left running; the main tree's terminals come last.
	//
	// With the feed of every project to be had, the groups are the sidebar's:
	// a folder per project by name, the page's own marked, each foldable with a
	// + to start a conversation there, and another project's row switches the
	// page to it. Beside a sidebar there is no menu and no composer, the
	// sidebar having New. Archived is at its foot.
	const conversations = useConversationIndex(feed);
	const { agents, pending, available } = useReactive(
		feed,
		(feed) => ({
			agents: feed.agents,
			pending: feed.loading,
			available: feed.available,
		}),
		["changed"],
	);
	const { mains, beneath, close, confirm } = useShells(terminals, onOpen);
	const openNew = () => onOpen(NEW);
	const name = useProjectName(here?.repo);
	const unstarted = useUnstarted(drafts, null, false, agents, conversations);
	const { trees, hosting } = useMemo(() => {
		const rows = rowsOf(tasks, conversations, todos);
		// Each with the agents it handed out, in the group of the most pressing.
		const nested = nestRows(tasks, rows);
		// Listed with every row, then only what the inbox shows (see `shownIn`).
		const trees = shownIn(nested);
		const hosting = hostsAtWork(nested);
		return { rows, nested, trees, hosting };
	}, [tasks, conversations, todos]);
	const everywhere = useEverywhere((feed) => ({
		available: feed.available,
		listing: feed.loading,
		projects: feed.projects,
		tasks: feed.tasks,
		conversations: conversationIndex(feed),
	}));
	const grouped = useMemo(
		() =>
			everywhere.available && here !== null
				? foldersOf(
						everywhere.projects,
						everywhere.tasks,
						everywhere.conversations,
						{ ...here, tasks, conversations, todos },
					)
				: null,
		[
			everywhere.available,
			everywhere.projects,
			everywhere.tasks,
			everywhere.conversations,
			here,
			tasks,
			conversations,
			todos,
		],
	);
	const navigation = useContext(NavigationContext);
	const { folded, fold } = useFolded(FOLDED_FOLDERS);
	const open = (row: Needing, folder: Folder | null) => {
		if (folder !== null && !folder.here && folder.project !== null) {
			navigation.show(newConversationUrl(folder.project, openedBy(row)));
			return;
		}
		if (waitsOnYou(row)) {
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
	// Every project keeps its folder, each saying it is empty, so only the
	// flat list without them has an empty state.
	const empty = grouped === null && trees.length === 0;
	const wide = onMenu === null;
	return (
		<BoardScope todos={todos} lanes={lanes} boards={boards}>
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
					title={
						wide ? (
							"Inbox"
						) : (
							<ProjectSwitcher
								name={name}
								// The inbox stays the page, not the last thread there.
								hash="#conversations"
								path={false}
								servers={false}
								className="mx-0"
							/>
						)
					}
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
				{!wide && chips}
				<div className={cn("flex flex-1 flex-col", wide ? "pb-6" : "pb-28")}>
					<UnstartedGroup
						unstarted={unstarted}
						agents={agents}
						onOpen={onOpen}
					/>
					{/* Held while the all-projects listing is on its way, so the folders' headers and + do not push the flat groups down. */}
					{loading || pending || everywhere.listing ? (
						<InboxLoading />
					) : empty && mains.length === 0 && unstarted.length === 0 ? (
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
								<Group
									title="Conversations"
									items={trees.map((tree) => ({
										tree,
										folder: null,
										hosting,
									}))}
									agents={agents}
									beneath={beneath}
									onOpen={open}
								/>
							) : (
								grouped.map((folder) => {
									const key = folderKey(folder);
									return (
										<ProjectSection
											key={key}
											folder={folder}
											open={!folded.has(key)}
											onFold={(open) => fold(key, open)}
											onNew={available ? () => startIn(folder) : null}
											agents={agents}
											beneath={beneath}
											onOpen={open}
											onOpenQueued={onOpen}
										/>
									);
								})
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
					{available && (
						<div className="mt-2 border-t">
							<button
								type="button"
								onClick={() => onOpen(ARCHIVED)}
								className="flex min-h-16 w-full select-none items-center gap-3 px-4 py-2.5 text-left text-muted-foreground hover:bg-muted active:bg-muted"
							>
								<span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted">
									<ArchiveIcon aria-hidden className="size-5" />
								</span>
								<span className="min-w-0 flex-1 truncate font-medium text-[15px]">
									Archived
								</span>
							</button>
						</div>
					)}
				</div>
				{confirm}
			</section>
		</BoardScope>
	);
}
