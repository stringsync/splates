import type { UniqueIdentifier } from "@dnd-kit/core";
import {
	SortableContext,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { CSSProperties, JSX, ReactNode, Ref } from "react";
import { cn } from "#dev/lib/utils.ts";
import type { TodoState } from "../todo";
import { Sortable } from "./card";

/**
 * A column a card can be dropped on, lit while one is over it: the cards in
 * it are their own targets, and the rest of it means the bottom. Every
 * column is a Trello list: a header, its cards, and a way to add one.
 */
export function Column({
	label,
	drop,
	lit,
	style,
	className,
	children,
}: {
	label: string;
	/** Where the column takes a dropped card. */
	drop: Ref<HTMLElement>;
	/** A card is over it. */
	lit: boolean;
	style?: CSSProperties;
	className?: string;
	children: ReactNode;
}): JSX.Element {
	return (
		<section
			ref={drop}
			aria-label={label}
			style={style}
			className={cn(
				"flex max-h-full w-72 shrink-0 snap-start flex-col gap-1.5 rounded-xl bg-muted/40 p-2 transition-colors dark:bg-muted/20",
				lit && "bg-primary/5 ring-1 ring-primary/30",
				className,
			)}
		>
			{children}
		</section>
	);
}

/** The lane of the card `id` names, null for none, undefined for no card. */
export function laneOfCard(
	todos: TodoState[],
	id: UniqueIdentifier | undefined,
): number | null | undefined {
	return todos.find((todo) => todo.id === id)?.lane;
}

/** A column's cards, top first, each a drag handle and a drop target. */
export function Cards({
	todos,
	label,
	staleness,
	steps,
	coming,
}: {
	todos: TodoState[];
	label: string;
	staleness: number;
	/** Number the cards, as a lane's steps are. */
	steps: boolean;
	/**
	 * A card from another column is over this one but none of its cards, so
	 * it lands at the bottom: a line there says so, as one above a card does.
	 */
	coming: boolean;
}): JSX.Element {
	return (
		<SortableContext
			items={todos.map((todo) => todo.id)}
			strategy={verticalListSortingStrategy}
		>
			{/* Scrolls on its own, so a long column keeps its header and its
			    add button in view. */}
			<ol
				aria-label={label}
				className="-mx-1 flex min-h-2 flex-col gap-1.5 overflow-y-auto px-1 py-0.5"
			>
				{todos.map((todo, i) => (
					<Sortable
						key={todo.id}
						todo={todo}
						staleness={staleness}
						step={steps ? i + 1 : undefined}
					/>
				))}
				{coming && (
					<li
						aria-hidden
						className="mx-1 h-1 shrink-0 rounded-full bg-primary"
					/>
				)}
			</ol>
		</SortableContext>
	);
}
