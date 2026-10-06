import { createContext } from "react";
import type { LaneRecord } from "../lanes";
import type { TodoState } from "../todo";

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
}

export const Board = createContext<BoardContext>({
	linked: false,
	todos: [],
	lanes: [],
	open: () => {},
	openTask: () => {},
});

/**
 * Keeps a press on a button inside a card from starting a drag of the card,
 * so a tap on it does what the button says.
 */
export const still = {
	onMouseDown: (event: { stopPropagation(): void }) => event.stopPropagation(),
	onTouchStart: (event: { stopPropagation(): void }) => event.stopPropagation(),
};
