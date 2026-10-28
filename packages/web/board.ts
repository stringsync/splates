import type {
	ElsewhereOnBoard,
	LaneRecord,
	TaskRecord,
} from "@stringsync/splates-server/board";
import { createContext } from "react";
import { Drafts } from "./drafts";

/** No board, as outside one: nothing to name and nothing to open. */
export const NO_BOARD: BoardContext = {
	linked: false,
	todos: [],
	lanes: [],
	open: () => {},
	openTask: () => {},
	openLane: () => {},
	openTodos: () => {},
	tasks: [],
	moveLane: () => {},
	refusedTodos: new Map(),
	refuseTodo: () => {},
	refusedLanes: new Map(),
	refuseLane: () => {},
	drafts: new Drafts(),
};

export const Board = createContext<BoardContext>(NO_BOARD);

/**
 * What any card on the board can reach: every todo and lane, to name the
 * ones blocking it, and the page's ways to open a todo or a task.
 */
export interface BoardContext {
	/** Whether this is a board at all, rather than the empty default. */
	linked: boolean;
	todos: TaskRecord[];
	/** Every lane, in board order, to call each by its name. */
	lanes: LaneRecord[];
	/** Where its todos' blockers in other projects stand, and theirs it blocks; absent unread. */
	elsewhere?: ElsewhereOnBoard;
	open: (id: number) => void;
	openTask: (task: string) => void;
	/** Opens the board on lane `id`, scrolled to its column. */
	openLane: (id: number) => void;
	/** Opens the todo board showing only the todos in `ids`. */
	openTodos: (ids: readonly number[]) => void;
	/** Every live task, by name: those a chip naming one opens. */
	tasks: readonly string[];
	/** Puts a lane at a position among the lanes, 1 the first column. */
	moveLane: (id: number, position: number) => void;
	/** What was refused of each card, by its id, said on the card. */
	refusedTodos: ReadonlyMap<number, string>;
	/** Says on todo `id`'s card that a write to it was refused. */
	refuseTodo: (id: number, title: string, error: unknown) => void;
	/** What was refused of each lane, by its id, under its header; null for Untriaged. */
	refusedLanes: ReadonlyMap<number | null, string>;
	refuseLane: (id: number | null, title: string, error: unknown) => void;
	/** Todos being added or edited and not yet sent, kept across pages. */
	drafts: Drafts;
	/** The card dropped whose move the server has yet to show, pending where it was let go. */
	moving?: number | null;
	/** The lane dropped whose move the server has yet to show. */
	movingLane?: number | null;
}

/**
 * Spread onto a button inside a draggable card so pressing it never starts
 * a drag of the card, and a tap does what the button says.
 */
export const still = {
	onMouseDown: (event: { stopPropagation(): void }) => event.stopPropagation(),
	onTouchStart: (event: { stopPropagation(): void }) => event.stopPropagation(),
};

/**
 * A board menu's items at a finger's height on a touch screen, given to its
 * content and to each submenu's, which opens apart from it.
 */
export const touchItems = "pointer-coarse:[&_[role^=menuitem]]:min-h-10";

/**
 * The height of a one-line card, set in `--line-card`. Put it on the card,
 * and whatever stands beside it, as a person's message in a phone's thread,
 * can use `--line-card` to match.
 */
export const lineCardHeight = "[--line-card:calc(1.75rem+0.75rem+2px)]";

/**
 * A card that spans one line, as a waiting card's line in a phone's thread
 * or a bar above the composer: its call to action set in as far from the
 * card's end as from its top and bottom, as a longer card sets in its own.
 */
export const lineCard = `${lineCardHeight} min-h-(--line-card) py-1.5 pr-1.5`;

/**
 * Put it on a small `relative` control in a line of text to stretch its tap
 * target to a finger's height on a touch screen, the text left in place.
 */
export const touchArea =
	"pointer-coarse:after:absolute pointer-coarse:after:-inset-x-1 pointer-coarse:after:-inset-y-3";

/**
 * The task todo `id` opens as, once an agent took it: the same dialog the
 * task list opens. Null while no agent has it, or the page no longer knows
 * the task, as one merged a moment ago, so the todo's own dialog opens.
 */
export function takenTask(
	todos: readonly TaskRecord[],
	tasks: readonly { task: string }[],
	id: number,
): string | null {
	const taken = todos.find((todo) => todo.id === id)?.takenBy ?? null;
	return taken !== null && tasks.some((each) => each.task === taken)
		? taken
		: null;
}
