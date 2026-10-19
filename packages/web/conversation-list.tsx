import {
	answersTo,
	type Needing,
} from "@stringsync/splates-server/plans/browser";
import type { Details } from "@stringsync/splates-server/tasks";
import { useReactive } from "@webappwiz/react";
import { ArchiveIcon } from "lucide-react";
import {
	type JSX,
	type ReactNode,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import { cn } from "#web/lib/utils.ts";
import { ARCHIVED, NEW, openedBy, TASK } from "./conversation-address";
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
import { useBeneath } from "./list-beneath";
import { External, Rows, TerminalRow } from "./list-rows";
import { NavigationContext } from "./navigation";
import { newConversationUrl } from "./new-conversation-project";
import { type Nested, nest } from "./parts";
import {
	FolderList,
	ForeignItem,
	InLanes,
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
import { useCopiedReplies } from "./task-view";
import type { Terminals } from "./terminals";

/** How many agents at work the list shows folded, before a link to the rest. */
const WORKING = 3;

/** How many rows ⌥⌘ and a digit can open. */
const DIGITS = 10;

/** Where this browser keeps whether the list is unfolded. */
const UNFOLDED = "splates.sidebar.unfolded";

/**
 * The sidebar's agents, folded to up to three at work, newest first, then
 * "See N more" for the rest. Unfolded, as this browser keeps it, it lists
 * them all, after the main tree's own terminals, oldest first, until each is
 * closed, with the archived ones behind a link and "Show less" at the
 * bottom. Each row is named alone, with its task on hover. A conversation
 * follows its agent as it takes and lands tasks. A task whose agent runs
 * outside the page is a row of its own. Rows stay put as their agents change
 * state; each one's mark says whether it works or waits on you. Under a
 * conversation, muted as a subagent is, sit its terminal while its shell is
 * up and each command its agent left running, each opening in the pane
 * beside the page.
 *
 * The arrow keys move between rows, ⌥⌘0 to ⌥⌘9 (Ctrl+Alt off a Mac) open
 * the rows shown, top to bottom, and ⌥⌘] and ⌥⌘[ open the row below or
 * above the one open, in the unfolded order, main-tree terminals among
 * them, round past either end; each but the digits as the settings bind it.
 * Holding ⌥⌘ shows each of those keys beside what it opens.
 *
 * With the feed of every project to be had, the rows go in folders instead,
 * as `foldersOf` groups them: those waiting on you, whatever their project,
 * in Needs you on top, each naming its project, then a folder per project;
 * folded, those at work come from every folder in turn. Another project's
 * row opens by switching the page to that project, where its task, trunk
 * and lanes are the page's own.
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
	const { mains, beneath, closing } = useBeneath(terminals, open, onOpen);

	const rows = rowsOf(tasks, conversations);
	const archived = conversations.filter((each) => each.archived).length;
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
	const { folded, fold } = useFolded(FOLDED_FOLDERS);
	const [unfolded, setUnfolded] = useState(
		() => localStorage.getItem(UNFOLDED) === "true",
	);
	const unfold = (unfolded: boolean) => {
		localStorage.setItem(UNFOLDED, String(unfolded));
		setUnfolded(unfolded);
	};
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
	// Every agent but those listed, each with those it handed out.
	const more =
		(grouped === null
			? nested.length
			: grouped.needsYou.length +
				grouped.folders.reduce(
					(sum, folder) => sum + folder.working.length + folder.recent.length,
					0,
				)) - listed.length;
	// What ⌥⌘0 to ⌥⌘9 open: the rows that show.
	const shownEntries = unfolded
		? entries.slice(0, DIGITS)
		: listed.map(({ folder, tree }) => ({ folder, row: tree.row }));
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
		} else if (row.task !== null) {
			onOpen(`${TASK}${row.task.task}`);
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
			{unfolded ? (
				<>
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
					<button
						type="button"
						data-row
						onClick={() => unfold(false)}
						className={FOLD}
					>
						Show less
					</button>
				</>
			) : (
				<>
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
										rows={listed.map(({ tree }) => ({
											row: tree.row,
											parts: [],
										}))}
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
							onClick={() => unfold(true)}
							className={FOLD}
						>
							See {more} more
						</button>
					)}
				</>
			)}
			{closing.confirm}
		</nav>
	);
}

/** The line that unfolds the list, or folds it back. */
const FOLD =
	"flex items-center rounded-md px-3 py-1.5 text-left text-muted-foreground text-xs hover:bg-muted";

/** A row as the list shows it, with the folder it is in, or null for none. */
interface Entry {
	folder: Folder | null;
	row: Needing;
}
