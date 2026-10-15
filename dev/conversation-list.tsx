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
import { cn } from "#dev/lib/utils.ts";
import { answersTo, type Needing, needs } from "../needs";
import type { Details } from "../show";
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
	nextWaiting,
	rowsOf,
	seenFor,
	waitsOnYou,
} from "./conversation-rows";
import type { Drafts } from "./drafts";
import { useHeld } from "./hooks/use-held";
import { useHeldKey, useShortcut } from "./hooks/use-shortcut";
import { CommandRow, External, Rows, TerminalRow } from "./list-rows";
import { nest } from "./parts";
import { NestedPanesContext } from "./side-panes";
import { arriveAt, useCopiedReplies } from "./task-view";
import type { Terminals } from "./terminals";
import { WaitingLine } from "./waiting-line";

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
 * terminals among them, round past either end; each but the digits as the
 * settings bind it. Holding ⌥⌘ shows each of those keys beside what it opens.
 * Atop it, `NextWaiting` says how many wait on you, opening the
 * next as ⌥⌘M does.
 */
export function ConversationList({
	feed,
	terminals,
	drafts,
	tasks,
	open,
	onOpen,
}: {
	feed: ConversationFeed;
	/** The page's shells, the main tree's among them. */
	terminals: Terminals;
	/** Where a reply copied for an external agent is kept. */
	drafts: Drafts;
	tasks: Details[];
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
	const shells = new Set(up.split(" "));
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
						current={shown?.kind === "terminal"}
						onOpen={() => {
							onOpen(id);
							panes.showTerminal(id);
						}}
						onClose={() => terminals.close(id)}
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
	// As they show, each part under its task: what ⌥⌘0 to ⌥⌘9 open.
	const shown = flatten(nested).slice(0, DIGITS);
	const held = useHeld();
	const openRow = (row: Needing) => {
		if (row.conversation !== null) {
			onOpen(row.conversation.id);
		} else if (row.task !== null) {
			onOpen(`${TASK}${row.task.task}`);
		}
	};
	// The latest, for the listener below, which outlives a render.
	const openRowRef = useRef(openRow);
	openRowRef.current = openRow;
	const shownRef = useRef(shown);
	shownRef.current = shown;
	// Every row top to bottom, by what opens it: what ⌥⌘[ and ⌥⌘] step through.
	const stops = [
		...mains,
		...flatten(nested).flatMap((row) =>
			row.conversation !== null
				? [row.conversation.id]
				: row.task !== null
					? [`${TASK}${row.task.task}`]
					: [],
		),
	];
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
		if (stops.length === 0) {
			return false;
		}
		const at = stops.indexOf(open ?? "");
		const to =
			at === -1
				? by === 1
					? 0
					: stops.length - 1
				: (at + by + stops.length) % stops.length;
		onOpen(stops[to] ?? null);
		return true;
	};
	useShortcut("shortcuts.next", () => step(1));
	useShortcut("shortcuts.previous", () => step(-1));

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
			/>
			{mains.map((each) => (
				<TerminalRow
					key={each}
					name={terminals.nameOf(each)}
					onRename={(name) => terminals.rename(each, name)}
					current={open === each}
					onOpen={() => onOpen(each)}
					onClose={() => {
						if (open === each) {
							onOpen(NEW);
						}
						terminals.close(each);
					}}
				/>
			))}
			{/* None, and no list either: an empty one would still take a gap. */}
			{nested.length > 0 && (
				<Rows
					label="conversation list"
					rows={nested}
					beneath={beneath}
					render={(row) =>
						row.conversation !== null ? (
							<Item
								conversation={row.conversation}
								agent={agentName(agents, row.conversation.agent)}
								need={row.need}
								current={row.conversation.id === open}
								onOpen={() => openRow(row)}
								onLeft={
									row.conversation.id === open
										? () => goOn(rows, drafts, open, onOpen)
										: undefined
								}
								hint={held ? hintOf(shown, row) : null}
								hosting={hosting.has(row.conversation.id)}
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
									subagent={answersTo(row, conversations) !== null}
								/>
							)
						)
					}
				/>
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
		</nav>
	);
}

/**
 * A line atop the list saying how many agents wait on you, which opens the next
 * as ⌥⌘M (Ctrl+Alt+M off a Mac) does: the next one waiting, or else the next
 * merged, then unread, one, lighting the line when there is none.
 */
function NextWaiting({
	feed,
	drafts,
	tasks,
	open,
	onOpen,
}: {
	feed: ConversationFeed;
	/** Where a reply copied for an external agent is kept. */
	drafts: Drafts;
	tasks: Details[];
	/** The conversation shown, by id, or `ARCHIVED`. */
	open: string | null;
	onOpen: (id: string | null) => void;
}): JSX.Element {
	const { conversations } = useReactive(
		feed,
		(feed) => ({ conversations: feed.conversations }),
		["changed"],
	);
	const rows = rowsOf(tasks, conversations);
	useCopiedReplies(drafts);
	const held = useHeld();
	const waitingKey = useHeldKey("shortcuts.waiting");
	// Each time its shortcut finds nothing to open, for the waiting line to say so.
	const [nudges, setNudges] = useState(0);
	// The latest, for the listener below, which outlives a render.
	const next = useRef(() => {});
	next.current = () => {
		const waiting = nextWaiting(rows, drafts, open);
		if (waiting !== undefined) {
			arriveAt(openedBy(waiting));
			onOpen(openedBy(waiting));
		} else {
			setNudges((nudges) => nudges + 1);
		}
	};
	useShortcut("shortcuts.waiting", () => next.current());

	return (
		<WaitingLine
			waiting={rows.filter((row) => waitsOnYou(row, drafts)).length}
			nudges={nudges}
			hint={held ? waitingKey : null}
			onNext={() => next.current()}
		/>
	);
}

/**
 * How many agents wait on the person: conversations, and tasks whose agents
 * run outside the page, but for those whose questions were seen or reply
 * copied.
 */
export function useWaiting(
	feed: ConversationFeed,
	drafts: Drafts,
	tasks: Details[],
): number {
	const { conversations } = useReactive(
		feed,
		(feed) => ({ conversations: feed.conversations }),
		["changed"],
	);
	useCopiedReplies(drafts);
	return needs({ tasks, conversations }).filter(
		({ conversation, task, need }) =>
			need.kind === "waiting" && !seenFor(drafts, conversation, task, need),
	).length;
}
