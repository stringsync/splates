import {
	lanesTaken,
	type TaskRecord,
} from "@stringsync/splates-server/board/browser";
import type { Needing } from "@stringsync/splates-server/plans/browser";
import type { Details } from "@stringsync/splates-server/tasks";
import { useReactive } from "@webappwiz/react";
import { ArchiveIcon } from "lucide-react";
import {
	type JSX,
	memo,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
} from "react";
import { cn } from "#web/lib/utils.ts";
import { ARCHIVED, NEW, openedBy } from "./conversation-address";
import { agentName, type ConversationFeed } from "./conversation-feed";
import { conversationIndex, useConversationIndex } from "./conversation-index";
import { Item } from "./conversation-item";
import {
	flatten,
	goOn,
	hintOf,
	hostsAtWork,
	nestRows,
	rowsOf,
	shownIn,
} from "./conversation-rows";
import { useEverywhere } from "./everywhere-context";
import { ListLoading, StaleRows } from "./freshness";
import { useHeld } from "./hooks/use-held";
import { useShortcut } from "./hooks/use-shortcut";
import { useBeneath } from "./list-beneath";
import { Rows, TerminalRow } from "./list-rows";
import { NavigationContext } from "./navigation";
import { newConversationUrl, projectUrl } from "./new-conversation-project";
import {
	ForeignItem,
	ProjectList,
	type RenderRow,
} from "./project-folder-list";
import { type Folder, foldersOf } from "./project-folders";
import { Placing, placesOf } from "./reparent";
import type { Terminals } from "./terminals";

/** How many rows ⌥⌘ and a digit can open. */
const DIGITS = 10;

/**
 * The sidebar's agents, all of them, after the main tree's own terminals,
 * oldest first, until each is closed, and the new conversations not started
 * yet, each listed from the moment its screen opens or while its draft holds
 * anything. Each row is named alone, with its
 * task on hover. A conversation follows its agent as it takes and lands
 * tasks. A task whose agent runs outside the page is a row of its own. Rows stay put as their agents change
 * state; each one's mark says whether it works or waits on you. Under a
 * conversation, muted as a subagent is, sit its terminal while its shell is
 * up and each command its agent left running, each opening in the pane
 * beside the page.
 *
 * The arrow keys move between rows, ⌥⌘0 to ⌥⌘9 (Ctrl+Alt off a Mac) open
 * the rows shown, top to bottom, and ⌥⌘] and ⌥⌘[ open the row below or
 * above the one open, in the list's order, main-tree terminals among
 * them, round past either end; each but the digits as the settings bind it.
 * Holding ⌥⌘ shows each of those keys beside what it opens.
 *
 * With the feed of every project to be had, the list shows one project at a
 * time, as `foldersOf` groups them: those waiting on you in every project,
 * then the page's own project's, then a line for each other project that
 * switches to it. Another project's row opens by switching the page to that
 * project, where its task, trunk and lanes are the page's own.
 */
export const ConversationList = memo(function ConversationList({
	feed,
	terminals,
	tasks,
	todos,
	here,
	open,
	onOpen,
}: {
	feed: ConversationFeed;
	/** The page's shells, the main tree's among them. */
	terminals: Terminals;
	tasks: Details[];
	/** The page's project's queued tasks, to read which lane each task at work is on. */
	todos: TaskRecord[];
	/** The project the page shows, as its snapshot has it. */
	here: { root: string; repo: string; trunk: string | null };
	/** The conversation shown, by id, or `ARCHIVED`. */
	open: string | null;
	onOpen: (id: string | null) => void;
}): JSX.Element {
	const conversations = useConversationIndex(feed);
	const { agents } = useReactive(feed, (feed) => ({ agents: feed.agents }), [
		"changed",
	]);
	const { mains, beneath, closing } = useBeneath(terminals, open, onOpen);

	const { rows, nested, hosting, listed, taken } = useMemo(() => {
		const rows = rowsOf(tasks, conversations);
		const nested = nestRows(tasks, rows);
		const hosting = hostsAtWork(nested);
		// What it lists of them, without the feed of every project.
		const listed = shownIn(nested);
		const taken = lanesTaken(todos);
		return { rows, nested, hosting, listed, taken };
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
			everywhere.available
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
	// Every row as it shows, each part under its task.
	const entries = useMemo<Entry[]>(
		() =>
			grouped === null
				? flatten(listed).map((row) => ({ folder: null, row }))
				: [
						...grouped.needsYou.flatMap(({ folder, tree }) =>
							flatten([tree]).map((row) => ({ folder, row })),
						),
						...flatten(grouped.here.listed).map((row) => ({
							folder: grouped.here,
							row,
						})),
					],
		[grouped, listed],
	);
	const shownEntries = entries.slice(0, DIGITS);
	const shown = shownEntries.map(({ row }) => row);
	const held = useHeld();
	const openEntry = ({ folder, row }: Entry) => {
		if (folder === null || folder.here || folder.project === null) {
			openRow(row);
		} else {
			navigation.show(newConversationUrl(folder.project, openedBy(row)));
		}
	};
	const openRow = (row: Needing) => {
		if (row.conversation !== null) {
			onOpen(row.conversation.id);
		}
	};
	// The latest, for the listener below, which outlives a render.
	const openRowRef = useRef(openEntry);
	openRowRef.current = openEntry;
	const shownRef = useRef(shownEntries);
	shownRef.current = shownEntries;
	useEffect(() => {
		const jump = (event: KeyboardEvent) => {
			const digit = /^Digit(\d)$/.exec(event.code)?.[1];
			if (
				digit !== undefined &&
				event.altKey &&
				(event.metaKey || event.ctrlKey)
			) {
				const row = shownRef.current[Number(digit)];
				if (row !== undefined) {
					event.preventDefault();
					openRowRef.current(row);
				}
			}
		};
		document.addEventListener("keydown", jump);
		return () => document.removeEventListener("keydown", jump);
	}, []);
	// From a row, round past either end; from no row, in from the top or the
	// bottom.
	const step = (by: 1 | -1) => {
		// The same rows and order as the sidebar, each by what it opens here,
		// or null for another project's.
		const stops = [
			...mains.map((main) => ({ at: main, go: () => onOpen(main) })),
			...entries.map((entry) => ({
				at:
					entry.folder === null || entry.folder.here
						? openedBy(entry.row)
						: null,
				go: () => openEntry(entry),
			})),
		];
		if (stops.length === 0) {
			return false;
		}
		const at = stops.findIndex((stop) => stop.at !== null && stop.at === open);
		const to =
			at === -1
				? by === 1
					? 0
					: stops.length - 1
				: (at + by + stops.length) % stops.length;
		stops[to]?.go();
		return true;
	};
	useShortcut("shortcuts.next", () => step(1));
	useShortcut("shortcuts.previous", () => step(-1));

	// A row of the page's own project.
	const goNext = useCallback(
		() => goOn(rows, open, taken, onOpen),
		[rows, open, taken, onOpen],
	);
	const placing = useMemo(
		() => ({
			places: placesOf(nested),
			agentOf: (
				each: import("@stringsync/splates-server/conversations").ConversationState,
			) => agentName(agents, each.agent),
		}),
		[nested, agents],
	);
	const renderHere = (row: Needing, nested: boolean): ReactNode =>
		row.conversation !== null ? (
			<ListItem
				conversation={row.conversation}
				agent={agentName(agents, row.conversation.agent)}
				need={JSON.stringify(row.need)}
				current={row.conversation.id === open}
				onOpen={onOpen}
				onLeft={row.conversation.id === open ? goNext : undefined}
				hint={held ? hintOf(shown, row) : null}
				hosting={hosting.has(row.conversation.id)}
				nested={nested}
			/>
		) : null;
	const renderRow: RenderRow = (folder, row, nested) =>
		folder.here ? (
			renderHere(row, nested)
		) : (
			<ForeignItem
				row={row}
				project={folder.name}
				agent={
					row.conversation === null
						? null
						: agentName(agents, row.conversation.agent)
				}
				hint={held ? hintOf(shown, row) : null}
				nested={nested}
				onOpen={() => openEntry({ folder, row })}
			/>
		);
	const beneathOf = (folder: Folder, row: Needing) =>
		folder.here ? beneath(row) : [];
	return (
		<nav
			aria-label="conversations"
			className="flex flex-col gap-3"
			onKeyDown={(event) => {
				const step =
					event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
				if (step === 0) {
					return;
				}
				const all = [
					...event.currentTarget.querySelectorAll<HTMLElement>("[data-row]"),
				];
				const at = all.indexOf(event.target as HTMLElement);
				const target = all[at + step];
				// Not from a dialog the list opened, whose keys bubble here too.
				if (at !== -1 && target !== undefined) {
					event.preventDefault();
					target.focus();
				}
			}}
		>
			{mains.map((each) => (
				<TerminalRow
					key={each}
					name={terminals.nameOf(each)}
					onRename={(name) => terminals.rename(each, name)}
					current={open === each}
					onOpen={() => onOpen(each)}
					onClose={() =>
						closing.close(each, () => {
							if (open === each) {
								onOpen(NEW);
							}
						})
					}
				/>
			))}
			<StaleRows>
				{/* Held while the listing of every project is on its way, so the rows
				    are not drawn flat and then moved into folders as it comes. */}
				{everywhere.listing ? (
					<ListLoading />
				) : grouped !== null ? (
					<Placing value={placing}>
						<ProjectList
							folders={grouped}
							onNew={() => onOpen(NEW)}
							onSwitch={(folder) => {
								if (folder.project !== null) {
									navigation.show(projectUrl(folder.project));
								}
							}}
							render={renderRow}
							beneath={beneathOf}
						/>
					</Placing>
				) : /* None, and no list either: an empty one would still take a gap. */
				listed.length === 0 ? null : (
					<Placing value={placing}>
						<Rows
							label="conversation list"
							rows={listed}
							beneath={beneath}
							render={(row, nested) => renderHere(row, nested)}
						/>
					</Placing>
				)}
			</StaleRows>
			{closing.confirm}
		</nav>
	);
});

/**
 * The sidebar's menu item for the archived conversations, with how many
 * there are, pinned at its foot under the list.
 */
export function ArchivedEntry({
	feed,
	open,
	onOpen,
}: {
	feed: ConversationFeed;
	/** The conversation shown, by id, or `ARCHIVED`. */
	open: string | null;
	onOpen: (id: string | null) => void;
}): JSX.Element {
	const { archived } = useReactive(
		feed,
		(feed) => ({
			archived: feed.conversations.filter((each) => each.archived).length,
		}),
		["changed"],
	);
	return (
		<button
			type="button"
			aria-current={open === ARCHIVED ? "page" : undefined}
			onClick={() => onOpen(ARCHIVED)}
			// As the page tabs above it look, so it reads as one of the menu's.
			className={cn(
				"flex h-9 w-full flex-none items-center gap-3 rounded-md px-3 text-left font-medium text-foreground/60 text-sm hover:text-foreground dark:text-muted-foreground dark:hover:text-foreground [&_svg]:size-4 [&_svg]:shrink-0",
				open === ARCHIVED &&
					"bg-accent text-foreground dark:text-foreground [&_svg]:text-primary",
			)}
		>
			<ArchiveIcon />
			<span className="flex-1">Archived</span>
			{archived > 0 && (
				<span className="text-muted-foreground text-xs tabular-nums">
					{archived}
				</span>
			)}
		</button>
	);
}

/** A row as the list shows it, with the folder it is in, or null for none. */
interface Entry {
	folder: Folder | null;
	row: Needing;
}

/** Stable row props let selection changes redraw only the two selected rows. */
const ListItem = memo(function ListItem({
	conversation,
	need,
	onOpen,
	...props
}: Omit<Parameters<typeof Item>[0], "need" | "onOpen"> & {
	need: string;
	onOpen: (id: string) => void;
}): JSX.Element {
	const parsed = useMemo(() => JSON.parse(need) as Needing["need"], [need]);
	return (
		<Item
			{...props}
			conversation={conversation}
			need={parsed}
			onOpen={() => onOpen(conversation.id)}
		/>
	);
});
