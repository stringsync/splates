import { createContext } from "react";
import type { LaneRecord } from "../lanes";
import type { Details } from "../show";
import type { TodoState } from "../todo";
import { Drafts } from "./drafts";

/**
 * What any card on the board can reach: every todo and lane, to name the
 * ones blocking it, and the page's ways to open a todo or a task.
 */
export interface BoardContext {
	/** Whether this is a board at all, rather than the empty default. */
	linked: boolean;
	todos: TodoState[];
	/** Every lane, in board order, to call each by its name. */
	lanes: LaneRecord[];
	open: (id: number) => void;
	openTask: (task: string) => void;
	/** Opens the todo board showing only the todos in `ids`. */
	openTodos: (ids: readonly number[]) => void;
	/** Every live task, by name: those a chip naming one opens. */
	tasks: readonly string[];
	/** Each live task's `ARBOR.md`, by its name, for what it assumed. */
	plans: ReadonlyMap<string, string>;
	/** Puts a lane at a position among the lanes, 1 the first column. */
	moveLane: (id: number, position: number) => void;
	/** What was refused of each card, by its id, said on the card. */
	refusedTodos: ReadonlyMap<number, string>;
	/**
	 * What was refused of each lane, by its id, said under its header; null
	 * for the Untriaged column.
	 */
	refusedLanes: ReadonlyMap<number | null, string>;
	refuseLane: (id: number | null, title: string, error: unknown) => void;
	/** Todos being added or edited and not yet sent, kept across pages. */
	drafts: Drafts;
}

/** No board, as outside one: nothing to name and nothing to open. */
export const NO_BOARD: BoardContext = {
	linked: false,
	todos: [],
	lanes: [],
	open: () => {},
	openTask: () => {},
	openTodos: () => {},
	tasks: [],
	plans: new Map(),
	moveLane: () => {},
	refusedTodos: new Map(),
	refusedLanes: new Map(),
	refuseLane: () => {},
	drafts: new Drafts(),
};

export const Board = createContext<BoardContext>(NO_BOARD);

/** Each of `tasks` that has an `ARBOR.md`, by its name. */
export function plansOf(
	tasks: readonly Pick<Details, "task" | "plan">[],
): ReadonlyMap<string, string> {
	return new Map(
		tasks.flatMap(({ task, plan }) => (plan === null ? [] : [[task, plan]])),
	);
}

/**
 * Keeps a press on a button inside a card from starting a drag of the card,
 * so a tap on it does what the button says.
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
 * A small control in a line of text, its tap target stretched to a finger's
 * height on a touch screen without moving the text around it. The control
 * has to be `relative`.
 */
export const touchArea =
	"pointer-coarse:after:absolute pointer-coarse:after:-inset-x-1 pointer-coarse:after:-inset-y-3";
