import { createContext } from "react";
import type { LaneRecord } from "../lanes";
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
	/** Every live task, by name: those a chip naming one opens. */
	tasks: readonly string[];
	/** Puts a lane at a position among the lanes, 1 the first column. */
	moveLane: (id: number, position: number) => void;
	/** What was refused of each card, by its id, said on the card. */
	refusedTodos: ReadonlyMap<number, string>;
	/** What was refused of each lane, by its id, said under its header. */
	refusedLanes: ReadonlyMap<number, string>;
	refuseLane: (id: number, title: string, error: unknown) => void;
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
	tasks: [],
	moveLane: () => {},
	refusedTodos: new Map(),
	refusedLanes: new Map(),
	refuseLane: () => {},
	drafts: new Drafts(),
};

export const Board = createContext<BoardContext>(NO_BOARD);

/**
 * Keeps a press on a button inside a card from starting a drag of the card,
 * so a tap on it does what the button says.
 */
export const still = {
	onMouseDown: (event: { stopPropagation(): void }) => event.stopPropagation(),
	onTouchStart: (event: { stopPropagation(): void }) => event.stopPropagation(),
};
