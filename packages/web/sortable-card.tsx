import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
	type JSX,
	type KeyboardEventHandler,
	type MouseEventHandler,
	type TouchEventHandler,
	useContext,
} from "react";
import { cn } from "#web/lib/utils.ts";
import { Board } from "./board";
import { Card, type CardProps } from "./card";
import { byHand } from "./todo-board";

/** One card in a column, holding its place while another is dragged over it. */
export function Sortable(props: CardProps): JSX.Element {
	const { todo } = props;
	const {
		attributes,
		listeners,
		setNodeRef,
		setActivatorNodeRef,
		transform,
		transition,
		isDragging,
		isOver,
		active,
	} = useSortable({ id: todo.id });
	// A card from another column, or from a lane's steps to the tasks under
	// it or back, lands just above this one: a line says so, since these
	// cards do not move aside for it.
	const { todos } = useContext(Board);
	const other = todos.find((each) => each.id === active?.id);
	const coming =
		isOver &&
		(other?.lane !== todo.lane ||
			(other !== undefined && byHand(other) !== byHand(todo)));
	return (
		<li
			ref={setNodeRef}
			style={{ transform: CSS.Translate.toString(transform), transition }}
			className={cn(
				"relative",
				coming &&
					"before:absolute before:inset-x-1 before:-top-1.5 before:h-1 before:rounded-full before:bg-primary",
			)}
		>
			<Card
				{...props}
				// The card answers a mouse and a finger; its grip, a keyboard.
				pointer={{
					onMouseDown: listeners?.onMouseDown as MouseEventHandler,
					onTouchStart: listeners?.onTouchStart as TouchEventHandler,
				}}
				grip={{
					...attributes,
					onKeyDown: listeners?.onKeyDown as KeyboardEventHandler,
					ref: setActivatorNodeRef,
				}}
				// The slot it leaves while it is in hand, where it will land.
				className={cn(
					isDragging &&
						"border-dashed bg-muted shadow-none *:invisible hover:shadow-none active:bg-muted",
				)}
			/>
		</li>
	);
}
