import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { BoardRecord, TaskRecord } from "@splates/server/board/browser";
import type { JSX, ReactNode } from "react";
import { cn } from "#web/lib/utils.ts";

/**
 * A board as a tile on the board index, in its cover color: its name, how many
 * tasks are on it and how many of them are queued. Pass `action`
 * for the tile's ⋯ menu, which shows on hover with a mouse and always on a
 * touch screen.
 */
export function BoardTile({
	name,
	id,
	tasks,
	current,
	onOpen,
	action,
	title,
	icon,
}: {
	name: string;
	id: number;
	tasks: TaskRecord[];
	current?: boolean;
	onOpen: () => void;
	action?: ReactNode;
	title?: string;
	icon?: ReactNode;
}): JSX.Element {
	const queuedCount = tasks.filter((task) => task.stage === "queued").length;
	const cover = coverOf(id);
	return (
		<div className="group relative">
			<button
				type="button"
				onClick={onOpen}
				title={title}
				data-accent={cover.accent}
				className={cn(
					"flex h-28 w-full flex-col justify-between rounded-lg p-3 text-left shadow-sm outline-none transition-[filter] hover:brightness-110 focus-visible:ring-3 focus-visible:ring-ring/60",
					cover.className,
					current &&
						"ring-2 ring-foreground/40 ring-offset-2 ring-offset-background",
				)}
			>
				<span className="flex min-w-0 items-center gap-2 pr-16 font-semibold">
					{icon}
					<span className="truncate">{name}</span>
				</span>
				<span className="flex min-w-0 items-center gap-1.5 text-(--cover-muted) text-xs tabular-nums">
					<span className="truncate">
						{plural(tasks.length, "task")}
						{` · ${queuedCount} queued`}
					</span>
				</span>
			</button>
			<div className="absolute top-1.5 right-1.5 flex items-center gap-0.5 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100">
				{action}
			</div>
		</div>
	);
}

/**
 * Trello-like covers: muted, mid-dark blues, greens and the like that keep
 * white text readable without glaring. A board takes one by its id, so it
 * keeps its color. The classes are written out whole so Tailwind finds them.
 */
const COVERS = [
	{
		accent: "blue",
		gradient:
			"bg-gradient-to-br from-[oklch(0.52_0.12_252)] to-[oklch(0.42_0.12_258)]",
	},
	{
		accent: "green",
		gradient:
			"bg-gradient-to-br from-[oklch(0.52_0.1_155)] to-[oklch(0.42_0.1_160)]",
	},
	{
		accent: "amber",
		gradient:
			"bg-gradient-to-br from-[oklch(0.6_0.11_65)] to-[oklch(0.5_0.11_58)]",
	},
	{
		accent: "rose",
		gradient:
			"bg-gradient-to-br from-[oklch(0.54_0.12_15)] to-[oklch(0.44_0.12_10)]",
	},
	{
		accent: "violet",
		gradient:
			"bg-gradient-to-br from-[oklch(0.52_0.12_300)] to-[oklch(0.42_0.12_305)]",
	},
	{
		accent: "teal",
		gradient:
			"bg-gradient-to-br from-[oklch(0.52_0.09_200)] to-[oklch(0.42_0.09_205)]",
	},
	{
		accent: "indigo",
		gradient:
			"bg-gradient-to-br from-[oklch(0.5_0.12_272)] to-[oklch(0.4_0.12_275)]",
	},
] as const;

/**
 * A board's cover: the color it wears (slate for the Queue, id 0) and the
 * gradient and text classes that read on it.
 */
export function coverOf(id: number): {
	accent: string | undefined;
	className: string;
} {
	const text = "text-white [--cover-muted:rgb(255_255_255/0.85)]";
	if (id === 0) {
		return {
			accent: undefined,
			className: `bg-gradient-to-br from-slate-600 to-slate-800 ${text}`,
		};
	}
	const cover = COVERS[(id - 1 + COVERS.length) % COVERS.length] ?? COVERS[0];
	return {
		accent: cover.accent,
		className: `${cover.gradient} ${text}`,
	};
}

/** Wraps a tile so it can be dragged to another place; `locked` turns that off. */
export function SortableTile({
	board,
	locked,
	children,
}: {
	board: BoardRecord;
	locked: boolean;
	children: ReactNode;
}): JSX.Element {
	const { listeners, setNodeRef, transform, transition, isDragging } =
		useSortable({ id: board.id, disabled: locked });
	return (
		<li
			ref={setNodeRef}
			style={{ transform: CSS.Translate.toString(transform), transition }}
			className={cn(
				"relative list-none select-none [-webkit-touch-callout:none]",
				isDragging && "z-10 scale-[1.02] opacity-90 shadow-lg",
			)}
			{...(locked ? {} : listeners)}
		>
			{children}
		</li>
	);
}

/** `count` and `word`, made plural unless it is one. */
function plural(count: number, word: string): string {
	return `${count} ${word}${count === 1 ? "" : "s"}`;
}
