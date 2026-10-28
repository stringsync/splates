import type { Needing } from "@stringsync/splates-server/plans";
import type { Details } from "@stringsync/splates-server/tasks";
import { useReactive } from "@webappwiz/react";
import { ArchiveIcon, MenuIcon, SquarePenIcon } from "lucide-react";
import { Fragment, type JSX, type ReactNode, useContext, useMemo } from "react";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
} from "#web/components/ui/empty.tsx";
import { cn } from "#web/lib/utils.ts";
import { arriveAt } from "./arrivals";
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
import type { Nested } from "./parts";
import { Group, ProjectSection } from "./phone-inbox-groups";
import { TerminalGroup, useShells } from "./phone-inbox-shells";
import {
	FOLDED_FOLDERS,
	type Folder,
	folderKey,
	foldersOf,
	groupsOf,
} from "./project-folders";
import { useProjectName } from "./project-places";
import { ProjectSwitcher } from "./projects";
import { Placing, placesOf } from "./reparent";
import type { Terminals } from "./terminals";
import { BarButton, TopBar } from "./top-bar";

/**
 * Lists every agent by what it asks of you, to open, rename, mark unread or
 * archive. Render it as the phone's home with `onMenu` opening the drawer,
 * or with `onMenu` null as the page the sidebar's Inbox opens.
 */
export function Inbox({
	feed,
	drafts,
	terminals,
	tasks,
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
	/** The project the page shows, as its snapshot has it; null before it comes. */
	here: { root: string; repo: string; trunk: string | null } | null;
	/** The row of the project's pages under a phone's bar. */
	chips?: ReactNode;
	/** Whether the project snapshot is still on its way. */
	loading: boolean;
	/** Opens the phone's drawer; null beside a sidebar. */
	onMenu: (() => void) | null;
	onOpen: (id: string) => void;
}): JSX.Element {
	// Those waiting on you come first, then those at work, then the rest,
	// newest first in each, each row saying what it waits on. The agents one
	// handed out sit under it in its group, since they answer to it. A tap on
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
		const pinned = shown(groups.pinned);
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
				<UnstartedGroup unstarted={unstarted} agents={agents} onOpen={onOpen} />
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
						{grouped === null
							? [
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
											beneath={beneath}
											onOpen={open}
										/>
									</Fragment>
								))
							: grouped.map((folder) => {
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
										/>
									);
								})}
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
					<button
						type="button"
						onClick={() => onOpen(ARCHIVED)}
						className="mx-4 mt-6 flex items-center gap-2 self-start rounded-md px-3 py-1.5 text-muted-foreground text-xs hover:bg-muted active:bg-muted"
					>
						<ArchiveIcon className="size-3.5" />
						<span>Archived</span>
					</button>
				)}
			</div>
			{confirm}
		</section>
	);
}
