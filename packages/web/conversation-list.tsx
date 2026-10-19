import {
	answersTo,
	type Needing,
} from "@stringsync/splates-server/plans/browser";
import type { Details } from "@stringsync/splates-server/tasks";
import { useReactive } from "@webappwiz/react";
import { type JSX, type ReactNode, useContext, useEffect, useRef } from "react";
import { useCloseTerminal } from "./close-terminal";
import { openedBy, TASK, terminalAddress } from "./conversation-address";
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
import { InboxEntry } from "./next-waiting";
import { type Nested, nest } from "./parts";
import { ForeignItem, InLanes, type RenderRow } from "./project-folder-list";
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

/** How many agents at work the sidebar shows, before a link to the rest. */
const WORKING = 3;

/**
 * The sidebar's agents: the Inbox, counting those waiting on you, then up to
 * three agents at work, newest first, each named alone, with its task on
 * hover, and "+N more" for the rest at work, which opens the inbox, where
 * every agent is. Under a conversation, muted as a subagent is, sit its
 * terminal while its shell is up and each command its agent left running,
 * each opening in the pane beside the page.
 *
 * The arrow keys move between rows, ⌥⌘0 to ⌥⌘2 (Ctrl+Alt off a Mac) open
 * the rows shown, top to bottom, and ⌥⌘] and ⌥⌘[ open the agent below or
 * above the one open, in the inbox's order, main-tree terminals among them,
 * round past either end; each but the digits as the settings bind it.
 * Holding ⌥⌘ shows each of those keys beside what it opens. ⌥⌘M opens the
 * next agent waiting on you.
 *
 * With the feed of every project to be had, the agents at work come from
 * every project, `foldersOf`'s folders in turn, each of another project's
 * naming it and opening by switching the page to that project, where its
 * task, trunk and lanes are the page's own.
 */
export function ConversationList({
	feed,
	terminals,
	drafts,
	tasks,
	here,
	open,
	onOpen,
	inbox,
	onInbox,
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
	/** Whether the inbox is the page shown. */
	inbox: boolean;
	onInbox: () => void;
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

	const rows = rowsOf(tasks, conversations);
	useCopiedReplies(drafts);
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
	const { folded } = useFolded(FOLDED_FOLDERS);
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
	// The agents at work, each with the folder it is in, or null for none.
	const working: { folder: Folder | null; tree: Nested<Needing> }[] =
		grouped === null
			? nested
					.filter(
						(tree) =>
							!flatten([tree]).some((row) =>
								waitsOnYou(row, drafts, conversations),
							) &&
							flatten([tree]).some(
								(row) =>
									row.need.kind === "working" || row.need.kind === "assuming",
							),
					)
					.map((tree) => ({ folder: null, tree }))
			: grouped.folders.flatMap((folder) =>
					folder.working.map((tree) => ({ folder, tree })),
				);
	const listed = working.slice(0, WORKING);
	const more = working.length - listed.length;
	// What ⌥⌘0 to ⌥⌘2 open.
	const shown = listed.map(({ tree }) => tree.row);
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
	const shownEntries = listed.map(({ folder, tree }) => ({
		folder,
		row: tree.row,
	}));
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
	// Waiting on you in other projects, for the Inbox to count and ⌥⌘M to open.
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
			<InboxEntry
				feed={feed}
				drafts={drafts}
				tasks={tasks}
				open={open}
				onOpen={onOpen}
				inbox={inbox}
				onInbox={onInbox}
				elsewhere={elsewhere.length}
				onElsewhere={() => {
					const first = elsewhere[0];
					if (first !== undefined) {
						openEntry(first);
					}
				}}
			/>
			{/* None, and no list either: an empty one would still take a gap. */}
			{listed.length > 0 && (
				<Placing
					value={{
						places: placesOf(nested),
						agentOf: (each) => agentName(agents, each.agent),
					}}
				>
					<section aria-label="Working" className="flex flex-col">
						{grouped === null ? (
							<Rows
								label="conversation list"
								rows={listed.map(({ tree }) => ({ row: tree.row, parts: [] }))}
								beneath={beneath}
								render={(row, nested) => renderHere(row, nested, null)}
							/>
						) : (
							listed.map(({ folder, tree }) =>
								folder === null ? null : (
									<InLanes
										key={`${folderKey(folder)} ${openedBy(tree.row)}`}
										folder={folder}
									>
										<Rows
											label={`working in ${folder.name}`}
											rows={[{ row: tree.row, parts: [] }]}
											beneath={(row) => beneathOf(folder, row)}
											render={(row, nested) =>
												renderRow(folder, row, nested, !folder.here)
											}
										/>
									</InLanes>
								),
							)
						)}
					</section>
				</Placing>
			)}
			{more > 0 && (
				<button
					type="button"
					data-row
					onClick={onInbox}
					className="flex items-center rounded-md px-3 py-1.5 text-left text-muted-foreground text-xs hover:bg-muted"
				>
					+{more} more
				</button>
			)}
			{closing.confirm}
		</nav>
	);
}

/** A row as the list shows it, with the folder it is in, or null for none. */
interface Entry {
	folder: Folder | null;
	row: Needing;
}
