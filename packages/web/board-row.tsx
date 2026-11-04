import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { BoardRecord, TaskRecord } from "@splates/server/board/browser";
import { GripVerticalIcon } from "lucide-react";
import type { JSX, ReactNode } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { cn } from "#web/lib/utils.ts";

/** Wrap a board's row content in it to give the row a grip that drags the board to another place; `locked` turns the grip off. */
export function SortableRow({
	board,
	locked,
	className,
	children,
}: {
	board: BoardRecord;
	locked: boolean;
	className: string;
	children: ReactNode;
}): JSX.Element {
	const {
		attributes,
		listeners,
		setNodeRef,
		setActivatorNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id: board.id, disabled: locked });
	return (
		<li
			ref={setNodeRef}
			style={{ transform: CSS.Translate.toString(transform), transition }}
			className={cn(
				className,
				"relative",
				isDragging && "z-10 bg-card shadow-md",
			)}
		>
			{locked ? null : (
				<button
					type="button"
					ref={setActivatorNodeRef}
					aria-label={`Drag ${board.name}`}
					className="flex min-h-11 shrink-0 cursor-grab touch-none [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100 focus-visible:opacity-100 items-center rounded-sm text-muted-foreground/60 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:cursor-grabbing"
					{...attributes}
					{...listeners}
				>
					<GripVerticalIcon className="size-4" />
				</button>
			)}
			{children}
		</li>
	);
}

/** Shows a field to type a board's name in: Enter saves it through `onDone`, Escape or Cancel calls it empty. */
export function NameField({
	initial,
	onDone,
}: {
	initial: string;
	onDone: (value: string) => void;
}): JSX.Element {
	return (
		<form
			className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
			onSubmit={(event) => {
				event.preventDefault();
				const field = event.currentTarget.elements.namedItem(
					"boardName",
				) as HTMLInputElement;
				onDone(field.value);
			}}
		>
			<input
				// biome-ignore lint/a11y/noAutofocus: opened by the person's click on Create or Rename
				autoFocus
				name="boardName"
				defaultValue={initial}
				aria-label="Board name"
				onKeyDown={(event) => {
					if (event.key === "Escape") {
						event.preventDefault();
						onDone("");
					}
				}}
				className="min-w-0 flex-1 rounded-md border bg-transparent px-2 py-2 text-base outline-none md:text-sm"
			/>
			<Button type="submit" size="sm">
				Save
			</Button>
			<Button
				type="button"
				size="sm"
				variant="ghost"
				onClick={() => onDone("")}
			>
				Cancel
			</Button>
		</form>
	);
}

/** Whether a task there needs a look: one running or blocked. */
export function needsLook(task: TaskRecord): boolean {
	return task.stage === "running" || task.blockedBy.length > 0;
}
