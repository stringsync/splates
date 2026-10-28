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
import { PendingSpinner, pendingRow, useShowPending } from "./pending";
import { byHand } from "./todo-board";

/** A card in a column that can be dragged to another place, as `Card` takes it. */
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
	const { todos, moving } = useContext(Board);
	// Dropped here, until the server shows it moved.
	const pending = moving === todo.id;
	const showPending = useShowPending(pending);
	const other = todos.find((each) => each.id === active?.id);
	const coming =
		isOver &&
		(other?.lane !== todo.lane ||
			(other !== undefined && byHand(other) !== byHand(todo)));
	return (
		<li
			ref={setNodeRef}
			style={{ transform: CSS.Translate.toString(transform), transition }}
			{...pendingRow(
				pending,
				showPending,
				cn(
					"relative",
					coming &&
						"before:absolute before:inset-x-1 before:-top-1.5 before:h-1 before:rounded-full before:bg-primary",
				),
			)}
		>
			{pending && (
				<PendingSpinner
					shown={showPending}
					className="absolute top-2 right-2 z-10 size-3.5 text-muted-foreground"
				/>
			)}
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
