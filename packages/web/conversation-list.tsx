import {
	answersTo,
	type Needing,
} from "@stringsync/splates-server/plans/browser";
import type { Details } from "@stringsync/splates-server/show";
import { useReactive } from "@webappwiz/react";
import { ArchiveIcon } from "lucide-react";
import { type JSX, type ReactNode, useContext, useEffect, useRef } from "react";
import { cn } from "#web/lib/utils.ts";
import { useCloseTerminal } from "./close-terminal";
import {
	ARCHIVED,
	NEW,
	openedBy,
	TASK,
	terminalAddress,
} from "./conversation-address";
import { agentName, type ConversationFeed } from "./conversation-feed";
import { Item } from "./conversation-item";
import {
	copiedFor,
	flatten,
	goOn,
	hintOf,
	hostsAtWork,
	isHostOf,
	rowsOf,
	seenFor,
	waitsOnYou,
} from "./conversation-rows";
import type { Drafts } from "./drafts";
import { useEverywhere } from "./everywhere-context";
import { useFolded } from "./folded";
import { useHeld } from "./hooks/use-held";
import { useShortcut } from "./hooks/use-shortcut";
import { CommandRow, External, Rows, TerminalRow } from "./list-rows";
import { NavigationContext } from "./navigation";
import { newConversationUrl } from "./new-conversation-project";
import { NextWaiting } from "./next-waiting";
import { nest } from "./parts";
import {
	FolderList,
	ForeignItem,
	NeedsYou,
	type RenderRow,
} from "./project-folder-list";
import {
	FOLDED_FOLDERS,
	type Folder,
	folderKey,
	foldersOf,
} from "./project-folders";
import { Placing, placesOf } from "./reparent";
import { NestedPanesContext } from "./side-panes";
import { useCopiedReplies } from "./task-view";
import { OpenTerminalPage } from "./terminal";
import type { Terminals } from "./terminals";

/** How many rows ⌥⌘ and a digit can open. */
const DIGITS = 10;

/**
 * The sidebar's conversations, in one list, newest first, after
 * the main tree's own terminals, oldest first, until each is closed. Each
 * row is named alone, with its task on hover. A conversation follows its agent
 * as it takes and lands tasks. A task whose agent runs outside the page is a
 * row of its own. Rows stay put as their agents change state; each one's mark
 * says whether it works or waits on you. Under a conversation, muted as a
 * subagent is, sit its terminal while its shell is up and each command its
 * agent left running, each opening in the pane beside the page. Archived ones sit behind a link at
 * the bottom.
 *
 * The arrow keys move between rows, ⌥⌘0 to ⌥⌘9 (Ctrl+Alt off a Mac) open
 * the first ten rows, top to bottom, and ⌥⌘] and ⌥⌘[ open the row below or above the one open,
 * main-tree terminals among them, round past either end; each but the digits as the
 * settings bind it. Holding ⌥⌘ shows each of those keys beside what it opens.
 * Atop it, `NextWaiting` says how many wait on you, opening the
 * next as ⌥⌘M does.
 *
 * With the feed of every project to be had, the rows go in folders instead,
 * as `foldersOf` groups them: those waiting on you, whatever their project,
 * in Needs you on top, each naming its project, then a folder per project.
 * Another project's row opens by switching the page to that project, where
 * its task, trunk and lanes are the page's own.
 */
export function ConversationList({
	feed,
	terminals,
	drafts,
	tasks,
	here,
	open,
	onOpen,
}: {
	feed: ConversationFeed;
	/** The page's shells, the main tree's among them. */
	terminals: Terminals;
	/** Where a reply copied for an external agent is kept. */
	drafts: Drafts;
	tasks: Details[];
	/** The project the page shows, as its snapshot has it. */
	here: { root: string; repo: string; trunk: string | null };
	/** The conversation shown, by id, or `ARCHIVED`. */
	open: string | null;
	onOpen: (id: string | null) => void;
}): JSX.Element {
	const { agents, conversations } = useReactive(
		feed,
		(feed) => ({ agents: feed.agents, conversations: feed.conversations }),
		["changed"],
	);
	const { mains, up } = useReactive(
		terminals,
		(terminals) => ({
			mains: terminals.mains,
			up: terminals.up().join(" "),
			// Unread, but a rename shows at once.
			names: terminals.names,
		}),
		["changed"],
	);
	const panes = useContext(NestedPanesContext);
	const openPage = useContext(OpenTerminalPage);
	const shells = new Set(up.split(" "));
	const closing = useCloseTerminal(terminals);
	const beneath = ({ conversation }: Needing): ReactNode[] => {
		if (conversation === null || panes === null) {
			return [];
		}
		const { id } = conversation;
		const { showing } = panes;
		const shown = open === id ? showing : null;
		return [
			shells.has(id) && (
				<li key="terminal">
					<TerminalRow
						name={terminals.nameOf(id)}
						nested
						current={shown?.kind === "terminal" || open === terminalAddress(id)}
						onOpen={() => (openPage === null ? onOpen(id) : openPage(id))}
						onClose={() =>
							closing.close(id, () => {
								// Its pane or page, left up, would start another shell.
								if (open === terminalAddress(id)) {
									onOpen(id);
								}
								if (open === id || open === terminalAddress(id)) {
									terminals.hide();
								}
							})
						}
						onRename={(name) => terminals.rename(id, name)}
					/>
				</li>
			),
			...conversation.background
				.filter((each) => each.state === "running")
				.map((each) => (
					<li key={`background ${each.id}`}>
						<CommandRow
							background={each}
							current={
								shown?.kind === "background" && shown.background === each.id
							}
							onOpen={() => {
								onOpen(id);
								panes.watch(id, each.id);
							}}
						/>
					</li>
				)),
		].filter(Boolean);
	};

	const listed = conversations.filter((each) => !each.archived);
	const rows = rowsOf(tasks, conversations);
	useCopiedReplies(drafts);
	const archived = conversations.length - listed.length;
	const nested = nest(rows, (host, part) => isHostOf(tasks, host, part));
	const hosting = hostsAtWork(nested);
	const everywhere = useEverywhere(
		({ available, projects, tasks, conversations }) => ({
			available,
			projects,
			tasks,
			conversations,
		}),
	);
	const grouped = everywhere.available
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
	// Every row as it shows, each part under its task, the folded folders' left out.
	const entries: Entry[] =
		grouped === null
			? flatten(nested).map((row) => ({ folder: null, row }))
			: [
					...grouped.needsYou.flatMap(({ folder, tree }) =>
						flatten([tree]).map((row) => ({ folder, row })),
					),
					...grouped.folders
						.filter((folder) => !folded.has(folderKey(folder)))
						.flatMap((folder) =>
							flatten([...folder.working, ...folder.recent]).map((row) => ({
								folder,
								row,
							})),
						),
				];
	// What ⌥⌘0 to ⌥⌘9 open.
	const shown = entries.slice(0, DIGITS).map(({ row }) => row);
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
		} else if (row.task !== null) {
			onOpen(`${TASK}${row.task.task}`);
		}
	};
	// The latest, for the listener below, which outlives a render.
	const openRowRef = useRef(openEntry);
	openRowRef.current = openEntry;
	const shownRef = useRef(entries.slice(0, DIGITS));
	shownRef.current = entries.slice(0, DIGITS);
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

	// A row of the page's own project, `project` named after it in Needs you.
	const renderHere = (
		row: Needing,
		nested: boolean,
		project: string | null,
	): ReactNode =>
		row.conversation !== null ? (
			<Item
				conversation={row.conversation}
				agent={agentName(agents, row.conversation.agent)}
				need={row.need}
				current={row.conversation.id === open}
				onOpen={() => openRow(row)}
				onLeft={
					row.conversation.id === open
						? () => goOn(rows, drafts, conversations, open, onOpen)
						: undefined
				}
				hint={held ? hintOf(shown, row) : null}
				project={project}
				hosting={hosting.has(row.conversation.id)}
				nested={nested}
			/>
		) : (
			row.task !== null && (
				<External
					task={row.task}
					need={row.need}
					copied={copiedFor(drafts, null, row.task, row.need)}
					seen={seenFor(drafts, null, row.task, row.need)}
					current={`${TASK}${row.task.task}` === open}
					onOpen={() => openRow(row)}
					hint={held ? hintOf(shown, row) : null}
					project={project}
					subagent={answersTo(row, conversations) !== null}
				/>
			)
		);
	const renderRow: RenderRow = (folder, row, nested, named) =>
		folder.here ? (
			renderHere(row, nested, named ? folder.name : null)
		) : (
			<ForeignItem
				row={row}
				agent={
					row.conversation === null
						? null
						: agentName(agents, row.conversation.agent)
				}
				project={named ? folder.name : null}
				hint={held ? hintOf(shown, row) : null}
				nested={nested}
				onOpen={() => openEntry({ folder, row })}
			/>
		);
	const beneathOf = (folder: Folder, row: Needing) =>
		folder.here ? beneath(row) : [];
	// Waiting on you in other projects, for the waiting line to count and open.
	const elsewhere = (grouped?.needsYou ?? []).flatMap(({ folder, tree }) =>
		folder.here
			? []
			: flatten([tree])
					.filter((row) => waitsOnYou(row, drafts, folder.conversations))
					.map((row) => ({ folder, row })),
	);

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
			<NextWaiting
				feed={feed}
				drafts={drafts}
				tasks={tasks}
				open={open}
				onOpen={onOpen}
				elsewhere={elsewhere.length}
				onElsewhere={() => {
					const first = elsewhere[0];
					if (first !== undefined) {
						openEntry(first);
					}
				}}
			/>
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
			{grouped !== null ? (
				<Placing
					value={{
						places: placesOf(nested),
						agentOf: (each) => agentName(agents, each.agent),
					}}
				>
					<NeedsYou
						placed={grouped.needsYou}
						render={renderRow}
						beneath={beneathOf}
					/>
					<FolderList
						folders={grouped.folders}
						folded={folded}
						onFold={fold}
						onNew={(folder) =>
							folder.here || folder.project === null
								? onOpen(NEW)
								: navigation.show(newConversationUrl(folder.project))
						}
						render={renderRow}
						beneath={beneathOf}
					/>
				</Placing>
			) : (
				/* None, and no list either: an empty one would still take a gap. */
				nested.length > 0 && (
					<Placing
						value={{
							places: placesOf(nested),
							agentOf: (each) => agentName(agents, each.agent),
						}}
					>
						<Rows
							label="conversation list"
							rows={nested}
							beneath={beneath}
							render={(row, nested) => renderHere(row, nested, null)}
						/>
					</Placing>
				)
			)}
			<button
				type="button"
				data-row
				aria-current={open === ARCHIVED ? "page" : undefined}
				onClick={() => onOpen(ARCHIVED)}
				className={cn(
					"flex items-center gap-2 rounded-md px-3 py-1.5 text-left text-muted-foreground text-xs hover:bg-muted",
					open === ARCHIVED && "bg-muted text-foreground",
				)}
			>
				<ArchiveIcon className="size-3.5" />
				<span className="flex-1">Archived</span>
				{archived > 0 && <span className="tabular-nums">{archived}</span>}
			</button>
			{closing.confirm}
		</nav>
	);
}

/** A row as the list shows it, with the folder it is in, or null for none. */
interface Entry {
	folder: Folder | null;
	row: Needing;
}
