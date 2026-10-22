import {
	lanesTaken,
	type TaskRecord,
} from "@stringsync/splates-server/board/browser";
import type { ConversationState } from "@stringsync/splates-server/conversations";
import type { Needing } from "@stringsync/splates-server/plans";
import type { Details } from "@stringsync/splates-server/tasks";
import { useReactive } from "@webappwiz/react";
import {
	ArchiveIcon,
	ArchiveRestoreIcon,
	MenuIcon,
	SquarePenIcon,
} from "lucide-react";
import {
	Fragment,
	type JSX,
	type ReactNode,
	useContext,
	useEffect,
	useMemo,
} from "react";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
} from "#web/components/ui/empty.tsx";
import { cn } from "#web/lib/utils.ts";
import { arriveAt } from "./arrivals";
import { ARCHIVED, NEW, openedBy } from "./conversation-address";
import { useArchive } from "./conversation-archive";
import { agentName, type ConversationFeed } from "./conversation-feed";
import { conversationIndex, useConversationIndex } from "./conversation-index";
import { useNameOf } from "./conversation-names";
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
import { InboxLoading, useFreshness } from "./freshness";
import { NavigationContext } from "./navigation";
import {
	laneUrl,
	newConversationUrl,
	useOpenNew,
} from "./new-conversation-project";
import type { Nested } from "./parts";
import { FolderSection, Group } from "./phone-inbox-groups";
import { TerminalGroup, useShells } from "./phone-inbox-shells";
import { clearUndo, useUndoOffer } from "./phone-undo";
import {
	FOLDED_FOLDERS,
	type Folder,
	folderKey,
	foldersOf,
	groupsOf,
} from "./project-folders";
import { Refusal, useRefusal } from "./refusal";
import { Placing, placesOf } from "./reparent";
import type { Terminals } from "./terminals";
import { BarButton, TopBar } from "./top-bar";

/**
 * The phone's home: every agent, sorted by what it asks of you. Those waiting
 * on you come first, then those at work, then the rest, newest first in each,
 * each row a finger's height saying what it waits on. The agents one handed
 * out, its subagents and parts, sit under it, in its group, since they answer
 * to it rather than to you. Those at work on one lane's tasks sit together
 * under the lane's title, as in the sidebar, which opens the lane on the
 * board. A tap on one waiting goes straight to what it
 * asks, a long press offers Rename, Mark as unread and Archive, and a swipe
 * left archives it, asking first as Archive does. The menu opens the drawer to switch projects, and the pen starts a new
 * conversation. Under each conversation, as in
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
	todos,
	here,
	status,
	loading,
	onMenu,
	onOpen,
	onLane,
}: {
	feed: ConversationFeed;
	/** Where a reply copied for an external agent is kept. */
	drafts: Drafts;
	terminals: Terminals;
	tasks: Details[];
	/** The page's project's queued tasks, to read which lane each task at work is on. */
	todos: TaskRecord[];
	/** The project the page shows, as its snapshot has it; null before it comes. */
	here: { root: string; repo: string; trunk: string | null } | null;
	/** Whether the server is offline or outdated, shown in the header. */
	status: ReactNode;
	/** Whether the project snapshot is still on its way. */
	loading: boolean;
	/** Opens the phone's drawer; null beside a sidebar. */
	onMenu: (() => void) | null;
	onOpen: (id: string) => void;
	/** Opens the page's project's board on lane `id`. */
	onLane: (id: number) => void;
}): JSX.Element {
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
	const { stale } = useFreshness();
	const { mains, beneath, close, confirm } = useShells(terminals, onOpen);
	// In the project the last one started in, which may be another's page.
	const openNew = useOpenNew(onOpen);
	const unstarted = useUnstarted(drafts, null, false, agents, conversations);
	const { trees, hosting, waiting, pinned, working, recent } = useMemo(() => {
		const rows = rowsOf(tasks, conversations);
		// Each with the agents it handed out, in the group of the most pressing.
		const nested = nestRows(tasks, rows);
		// Grouped with every row, then only what the inbox shows (see `shownIn`).
		const shown = (of: Nested<Needing>[]) => shownIn(of);
		const groups = groupsOf(nested);
		const trees = shown(nested);
		const hosting = hostsAtWork(nested);
		const waiting = shown(groups.waiting);
		// Without folders, persistent agents are pinned, ahead of those pinned.
		const pinned = shown([...groups.kept, ...groups.pinned]);
		const working = shown(groups.working);
		const recent = shown(groups.recent);
		return {
			rows,
			nested,
			groups,
			trees,
			hosting,
			waiting,
			pinned,
			working,
			recent,
		};
	}, [tasks, conversations]);
	const everywhere = useEverywhere((feed) => ({
		available: feed.available,
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
						{ ...here, tasks, conversations },
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
		],
	);
	const { folded, fold } = useFolded(FOLDED_FOLDERS);
	const navigation = useContext(NavigationContext);
	// An undo offered by a swipe lasts while you stay here and do nothing else.
	useEffect(() => {
		// Deferred, so StrictMode's remount in development keeps the offer.
		clearTimeout(leftTimer);
		return () => {
			leftTimer = setTimeout(clearUndo, 0);
		};
	}, []);
	const open = (row: Needing, folder: Folder | null) => {
		clearUndo();
		if (folder !== null && !folder.here && folder.project !== null) {
			navigation.show(newConversationUrl(folder.project, openedBy(row)));
			return;
		}
		if (waitsOnYou(row)) {
			arriveAt(openedBy(row));
		}
		onOpen(openedBy(row));
	};
	const taken = lanesTaken(todos);
	const lanesHere = { taken, onLane };
	const lanesOf = (folder: Folder) => ({
		taken: folder.lanesTaken ?? taken,
		onLane: (lane: number) =>
			folder.here || folder.project === null
				? onLane(lane)
				: navigation.show(laneUrl(folder.project, lane)),
	});
	const startIn = (folder: Folder) => {
		if (folder.here || folder.project === null) {
			onOpen(NEW);
		} else {
			navigation.show(newConversationUrl(folder.project));
		}
	};
	const empty =
		grouped === null
			? trees.length === 0
			: grouped.folders.every((each) => each.trees.length === 0);
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
				<UndoRow conversations={conversations} />
				<UnstartedGroup unstarted={unstarted} agents={agents} onOpen={onOpen} />
				{loading || pending || stale ? (
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
							[
								["Needs you", waiting],
								["Pinned", pinned],
								["Working", working],
								["Recent", recent],
							].map(([title, group]) => (
								<Fragment key={String(title)}>
									<Group
										title={String(title)}
										items={(group as Nested<Needing>[]).map((tree) => ({
											tree,
											folder: null,
											hosting,
										}))}
										agents={agents}
										urgent={title === "Needs you"}
										lanes={title === "Needs you" ? undefined : lanesHere}
										beneath={beneath}
										onOpen={open}
									/>
								</Fragment>
							))
						) : (
							<>
								<Group
									title="Needs you"
									items={grouped.needsYou}
									agents={agents}
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
										lanes={lanesOf(folder)}
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
						className="mx-4 mt-6 flex items-center gap-2 self-start rounded-md px-3 py-1.5 text-muted-foreground text-xs hover:bg-muted active:bg-muted"
					>
						<ArchiveIcon className="size-3.5" />
						<span>Archived</span>
						{archived > 0 && <span className="tabular-nums">{archived}</span>}
					</button>
				)}
			</div>
			{confirm}
		</section>
	);
}

let leftTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * A line above the list saying the conversation just swiped away is
 * archived, with Undo, until something else is done here or the inbox is
 * left: no timer takes it back.
 */
function UndoRow({
	conversations,
}: {
	conversations: ConversationState[];
}): JSX.Element | null {
	const offered = useUndoOffer();
	const conversation = conversations.find((each) => each.id === offered);
	if (conversation === undefined || !conversation.archived) {
		return null;
	}
	return <Undo key={conversation.id} conversation={conversation} />;
}

function Undo({
	conversation,
}: {
	conversation: ConversationState;
}): JSX.Element {
	const nameOf = useNameOf();
	const { refusal, refuse } = useRefusal();
	const { file } = useArchive(conversation, refuse);
	return (
		<div className="mx-3 mt-3 rounded-lg border bg-muted/50 px-3 py-2">
			<div className="flex items-center gap-2 text-sm">
				<ArchiveIcon className="size-4 shrink-0 text-muted-foreground" />
				<span className="min-w-0 flex-1 truncate">
					Archived <span className="font-medium">{nameOf(conversation)}</span>
				</span>
				<button
					type="button"
					onClick={() => {
						file();
						clearUndo();
					}}
					className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 font-medium text-primary active:bg-muted"
				>
					<ArchiveRestoreIcon className="size-4" />
					Undo
				</button>
			</div>
			<Refusal refusal={refusal} />
		</div>
	);
}
