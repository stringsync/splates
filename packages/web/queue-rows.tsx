import {
	closestCenter,
	DndContext,
	type DragEndEvent,
	KeyboardSensor,
	MouseSensor,
	TouchSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVerticalIcon, MoreHorizontalIcon } from "lucide-react";
import { type JSX, type ReactNode, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "#web/components/ui/dropdown-menu.tsx";
import { cn } from "#web/lib/utils.ts";
import { touchItems } from "./board";
import { usePendingSnapshot } from "./expecting";
import { pendingRow, useShowPending } from "./pending";

/**
 * One part of the Queue page's card: a plain band naming it and how many
 * it holds, then its rows, flush to the card's edges.
 */
export function QueueSection({
	title,
	count,
	children,
}: {
	title: string;
	count: ReactNode;
	children: ReactNode;
}): JSX.Element {
	return (
		<section aria-label={title} className="flex flex-col">
			<h3 className="flex h-8 items-center gap-1.5 border-y bg-muted/40 px-4 font-medium text-muted-foreground text-xs first:border-t-0 max-md:uppercase max-md:tracking-wide">
				{title}
				<span className="tabular-nums">{count}</span>
			</h3>
			<div className="flex flex-col divide-y divide-border/50">{children}</div>
		</section>
	);
}

/** What a section says while it holds nothing. */
export function QueueEmpty({ children }: { children: ReactNode }): JSX.Element {
	return (
		<p className="flex h-10 items-center px-4 text-muted-foreground text-sm">
			{children}
		</p>
	);
}

/** A button on a row: what it says and does. */
export interface RowAction {
	label: string;
	onClick: () => void;
	disabled?: boolean;
}

/**
 * A row of the Queue page: a column for its grip, its name, fixed columns
 * for who started it, how long and its number, then its actions, the menu
 * first and the main one last, at the far right. On a phone the columns
 * fold into a line under the name, and the quieter action into the menu.
 */
export function QueueRow({
	name,
	by,
	age,
	id,
	marks,
	menu,
	quiet,
	main,
	grip,
	dragging = false,
	pending: writing = false,
	pendingKey,
}: {
	name: ReactNode;
	by?: ReactNode;
	age?: ReactNode;
	id?: ReactNode;
	/** Marks after the name, as an agent waiting on the person. */
	marks?: ReactNode;
	/** The menu's items, every action past the two buttons. */
	menu?: ReactNode;
	/** The quieter action, a ghost button, moved into the menu on a phone. */
	quiet?: RowAction;
	/** The main action, an outline button. */
	main?: RowAction;
	/** The handle that drags it, for a row that reorders. */
	grip?: ReactNode;
	dragging?: boolean;
	/** A write to it is on its way: dimmed after a moment, its buttons held. */
	pending?: boolean;
	/** What a write to this row touches (`todo:3`, `lane:2`): the row shows it pending. */
	pendingKey?: string;
}): JSX.Element {
	const keyed = usePendingSnapshot(pendingKey ?? "");
	const pending = writing || keyed;
	const showPending = useShowPending(pending);
	const meta = [by, age, id].filter(
		(each) => each !== undefined && each !== null && each !== "",
	);
	return (
		<div
			{...pendingRow(
				pending,
				showPending,
				cn(
					"flex h-10 items-center gap-3 bg-card px-4 text-sm hover:bg-muted/50 max-md:h-auto max-md:min-h-16 max-md:py-2.5",
					dragging && "relative z-10 shadow-md",
				),
			)}
		>
			<span className="flex w-4 shrink-0 justify-center text-muted-foreground/60">
				{grip}
			</span>
			<span className="flex min-w-0 flex-1 flex-col">
				<span className="flex min-w-0 items-center gap-2">
					<span className="min-w-0 truncate max-md:font-medium max-md:text-[15px]">
						{name}
					</span>
					{marks}
				</span>
				{meta.length > 0 && (
					<span className="truncate text-muted-foreground text-xs md:hidden">
						{meta.map((each, at) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: a fixed few, in order
							<span key={at}>
								{at > 0 && " · "}
								{each}
							</span>
						))}
					</span>
				)}
			</span>
			<span className="w-28 shrink-0 truncate text-right text-muted-foreground text-xs max-md:hidden">
				{by}
			</span>
			<span className="w-8 shrink-0 text-right text-muted-foreground text-xs tabular-nums max-md:hidden">
				{age}
			</span>
			<span className="w-14 shrink-0 truncate text-right text-muted-foreground text-xs tabular-nums max-md:hidden">
				{id}
			</span>
			<span className="flex shrink-0 items-center justify-end gap-1 md:w-44">
				<RowMenu quiet={quiet} pending={pending}>
					{menu}
				</RowMenu>
				{quiet !== undefined && (
					<Button
						size="xs"
						variant="ghost"
						className="text-muted-foreground max-md:hidden"
						disabled={quiet.disabled || pending}
						onClick={quiet.onClick}
					>
						{quiet.label}
					</Button>
				)}
				{main !== undefined && (
					<Button
						size="xs"
						variant="outline"
						className="max-md:h-8 max-md:px-3 max-md:text-sm"
						disabled={main.disabled || pending}
						onClick={main.onClick}
					>
						{main.label}
					</Button>
				)}
			</span>
		</div>
	);
}

/**
 * The row's menu, with the quieter action at its head on a phone, where
 * the row has no room for its button; none when it would be empty.
 */
function RowMenu({
	quiet,
	pending,
	children,
}: {
	quiet: RowAction | undefined;
	pending: boolean;
	children: ReactNode;
}): JSX.Element | null {
	const empty =
		children === undefined || children === null || children === false;
	if (empty && quiet === undefined) {
		return <span className="size-6 shrink-0 max-md:size-9" />;
	}
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						size="icon-xs"
						variant="ghost"
						aria-label="More actions"
						disabled={pending}
						className={cn(
							"text-muted-foreground max-md:size-9",
							empty && "md:invisible",
						)}
					/>
				}
			>
				<MoreHorizontalIcon />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className={cn("w-56", touchItems)}>
				{quiet !== undefined && <QuietItem quiet={quiet} />}
				{children}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/** The quieter action as a menu item, shown on a phone alone. */
function QuietItem({ quiet }: { quiet: RowAction }): JSX.Element {
	return (
		<DropdownMenuItem
			className="md:hidden"
			disabled={quiet.disabled}
			onClick={quiet.onClick}
		>
			{quiet.label}
		</DropdownMenuItem>
	);
}

/** A row that reorders: its grip, and whether it is in hand. */
export interface Draggable {
	grip: ReactNode;
	dragging: boolean;
}

/**
 * Rows the person reorders by dragging each by its grip, by mouse, by a
 * long press or from the keyboard, drawn by `row`. `onMove` puts the row
 * of `id` at `to`, from 0; the list shows the new order at once and keeps
 * it until the order read changes.
 */
export function SortableRows<T>({
	items,
	idOf,
	label,
	row,
	onMove,
}: {
	items: readonly T[];
	idOf: (item: T) => string;
	label: string;
	row: (item: T, drag: Draggable) => ReactNode;
	onMove: (id: string, to: number) => void;
}): JSX.Element {
	const sensors = useSensors(
		useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
		useSensor(TouchSensor, {
			activationConstraint: { delay: 200, tolerance: 6 },
		}),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);
	// The order just dropped, kept until what the page reads moves, so a row
	// lands where it was let go instead of jumping back for a poll.
	const [dropped, setDropped] = useState<{
		from: string;
		order: string[];
	} | null>(null);
	const ids = items.map(idOf);
	const read = ids.join("\n");
	const order = dropped !== null && dropped.from === read ? dropped.order : ids;
	const byId = new Map(items.map((item) => [idOf(item), item]));
	const drop = ({ active, over }: DragEndEvent) => {
		if (over === null || active.id === over.id) {
			return;
		}
		const from = order.indexOf(String(active.id));
		const to = order.indexOf(String(over.id));
		if (from < 0 || to < 0) {
			return;
		}
		const next = [...order];
		next.splice(from, 1);
		next.splice(to, 0, String(active.id));
		setDropped({ from: read, order: next });
		onMove(String(active.id), to);
	};
	return (
		<DndContext
			sensors={sensors}
			collisionDetection={closestCenter}
			modifiers={[restrictToVerticalAxis]}
			onDragEnd={drop}
		>
			<SortableContext items={order} strategy={verticalListSortingStrategy}>
				<ol
					aria-label={label}
					className="flex flex-col divide-y divide-border/50"
				>
					{order.flatMap((id) => {
						const item = byId.get(id);
						return item === undefined
							? []
							: [
									<SortableRow
										key={id}
										id={id}
										row={(drag) => row(item, drag)}
									/>,
								];
					})}
				</ol>
			</SortableContext>
		</DndContext>
	);
}

/** One row in a `SortableRows`, moving aside as another is dragged over it. */
function SortableRow({
	id,
	row,
}: {
	id: string;
	row: (drag: Draggable) => ReactNode;
}): JSX.Element {
	const {
		attributes,
		listeners,
		setNodeRef,
		setActivatorNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id });
	return (
		<li
			ref={setNodeRef}
			style={{ transform: CSS.Translate.toString(transform), transition }}
		>
			{row({
				dragging: isDragging,
				grip: (
					<button
						type="button"
						ref={setActivatorNodeRef}
						aria-label="Drag to reorder"
						className="flex cursor-grab touch-none items-center rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:cursor-grabbing"
						{...attributes}
						{...listeners}
					>
						<GripVerticalIcon className="size-4" />
					</button>
				),
			})}
		</li>
	);
}
