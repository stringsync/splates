import {
	closestCenter,
	DndContext,
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
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
	type BoardRecord,
	DEFAULT_BOARD,
	type TaskRecord,
} from "@splates/server/board/browser";
import {
	ArchiveIcon,
	ArrowDownIcon,
	ArrowUpIcon,
	ChevronDownIcon,
	MoreHorizontalIcon,
	PencilIcon,
	PlusIcon,
	Trash2Icon,
} from "lucide-react";
import { type JSX, type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "#web/components/ui/dialog.tsx";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#web/components/ui/dropdown-menu.tsx";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#web/components/ui/popover.tsx";
import { cn } from "#web/lib/utils.ts";
import {
	addBoard,
	archiveBoard,
	dropBoard,
	moveBoard,
	moveLaneToBoard,
	renameBoard,
} from "./api";
import { ArchivedBoards } from "./board-archived";
import { DeleteBoard } from "./board-delete-dialog";
import { saveBoard } from "./board-places";
import { NameField, needsLook, SortableRow } from "./board-row";

/** Pass these operations to BoardSwitcher to create, edit, move, archive, or delete boards. */
export interface BoardActions {
	addBoard: (name: string) => Promise<unknown>;
	renameBoard: (id: number, name: string) => Promise<void>;
	archiveBoard: (id: number, archived: boolean) => Promise<void>;
	dropBoard: (id: number) => Promise<void>;
	moveBoard: (id: number, position: number) => Promise<void>;
	moveLaneToBoard: (lane: number, board: number) => Promise<void>;
}

const serverActions: BoardActions = {
	addBoard,
	renameBoard,
	archiveBoard,
	dropBoard,
	moveBoard,
	moveLaneToBoard,
};

/** A board's lanes and their tasks, as the switcher counts them. */
export interface BoardTasks {
	id: number;
	lanes: number[];
	tasks: TaskRecord[];
}

/**
 * The top bar's board switcher: names the current board and opens a list of
 * the project's boards in their order, each with its task count and
 * a dot when something there needs a look, with Create, and a menu on each to rename, reorder, archive or delete it. Typing
 * filters; `b` opens it.
 */
export function BoardSwitcher({
	boards,
	current,
	tasks,
	onPick,
	actions = serverActions,
	mode = "switcher",
	onBrowse,
	builtIn,
}: {
	boards: BoardRecord[];
	current: number;
	tasks: BoardTasks[];
	onPick: (id: number) => void;
	actions?: BoardActions;
	mode?: "switcher" | "index" | "current";
	onBrowse?: () => void;
	/** Index only: the Queue row, shown with the Default board in its own section. */
	builtIn?: ReactNode;
}): JSX.Element {
	const [open, setOpen] = useState(false);
	const [filter, setFilter] = useState("");
	const [editing, setEditing] = useState<number | "new" | null>(null);
	const [refused, setRefused] = useState<string | null>(null);
	const [deleting, setDeleting] = useState<BoardRecord | null>(null);
	const field = useRef<HTMLInputElement>(null);
	const live = boards.filter((each) => !each.archived);
	const now = live.find((each) => each.id === current) ?? live[0];

	useEffect(() => {
		const key = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			if (
				mode === "index" ||
				event.key !== "b" ||
				event.metaKey ||
				event.ctrlKey ||
				event.altKey ||
				target?.closest("input, textarea, select, [contenteditable]")
			) {
				return;
			}
			event.preventDefault();
			if (mode === "current") {
				onBrowse?.();
			} else {
				setOpen(true);
			}
		};
		window.addEventListener("keydown", key);
		return () => window.removeEventListener("keydown", key);
	}, [mode, onBrowse]);

	const isDefault = (board: BoardRecord) => board.id === DEFAULT_BOARD;
	const ordered = [...live].sort(
		(left, right) => left.position - right.position,
	);
	const shown = ordered.filter((each) =>
		each.name.toLowerCase().includes(filter.toLowerCase()),
	);
	const pinned = mode === "index" ? shown.filter(isDefault) : [];
	const sortable =
		mode === "index" ? shown.filter((each) => !isDefault(each)) : shown;
	const sensors = useSensors(
		useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
		useSensor(TouchSensor, {
			activationConstraint: { delay: 200, tolerance: 6 },
		}),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);
	const attempt = async (act: () => Promise<void>) => {
		try {
			await act();
			setRefused(null);
		} catch (error) {
			setRefused(error instanceof Error ? error.message : "Not saved");
		}
	};
	const shift = (board: BoardRecord, by: -1 | 1) => {
		const next =
			ordered[ordered.findIndex((each) => each.id === board.id) + by];
		if (next !== undefined) {
			void attempt(() => actions.moveBoard(board.id, next.position));
		}
	};
	const reorder = ({
		active,
		over,
	}: {
		active: { id: unknown };
		over: { id: unknown } | null;
	}) => {
		const target = ordered.find((each) => each.id === over?.id);
		if (target !== undefined && active.id !== over?.id) {
			void attempt(() => actions.moveBoard(Number(active.id), target.position));
		}
	};
	const submit = async (value: string) => {
		const name = value.trim();
		const target = editing;
		setEditing(null);
		if (name === "" || target === null) {
			return;
		}
		try {
			if (target === "new") {
				await actions.addBoard(name);
			} else {
				await actions.renameBoard(target, name);
			}
			setRefused(null);
		} catch (error) {
			setRefused(error instanceof Error ? error.message : "Not saved");
			setEditing(target);
		}
	};

	const management = (board: BoardRecord) => (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						size="icon"
						variant="ghost"
						aria-label={`${board.name} actions`}
						title="Board actions"
						className="max-md:size-11"
					/>
				}
			>
				<MoreHorizontalIcon />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-44">
				<DropdownMenuItem onClick={() => setEditing(board.id)}>
					<PencilIcon />
					Rename
				</DropdownMenuItem>
				<DropdownMenuItem
					disabled={
						(isDefault(board) && mode === "index") ||
						board.id === ordered[0]?.id
					}
					onClick={() => shift(board, -1)}
				>
					<ArrowUpIcon />
					Move up
				</DropdownMenuItem>
				<DropdownMenuItem
					disabled={
						(isDefault(board) && mode === "index") ||
						board.id === ordered.at(-1)?.id
					}
					onClick={() => shift(board, 1)}
				>
					<ArrowDownIcon />
					Move down
				</DropdownMenuItem>
				{isDefault(board) ? null : (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuItem
							onClick={() =>
								void attempt(() => actions.archiveBoard(board.id, true))
							}
						>
							<ArchiveIcon />
							Archive
						</DropdownMenuItem>
						<DropdownMenuItem
							variant="destructive"
							onClick={() => setDeleting(board)}
						>
							<Trash2Icon />
							Delete…
						</DropdownMenuItem>
					</>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
	const row = (board: BoardRecord, draggable: boolean) => {
		const own = tasks.find((each) => each.id === board.id)?.tasks ?? [];
		const inner = (
			<>
				{editing === board.id ? (
					<NameField
						initial={board.name}
						onDone={(value) => void submit(value)}
					/>
				) : (
					<button
						type="button"
						onClick={() => {
							saveBoard(board.id);
							onPick(board.id);
							setOpen(false);
						}}
						className={cn(
							"flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-accent",
							board.id === now?.id && "font-medium",
						)}
					>
						<span className="truncate">{board.name}</span>
						{own.some(needsLook) ? (
							<span
								role="img"
								aria-label="Needs a look"
								className="size-1.5 shrink-0 rounded-full bg-amber-500"
							/>
						) : null}
						<span className="ml-auto shrink-0 text-muted-foreground text-xs tabular-nums">
							{own.length}
						</span>
					</button>
				)}
				{management(board)}
			</>
		);
		const className =
			mode === "index"
				? "group flex min-h-16 items-center gap-2 py-2"
				: "group flex items-center gap-1";
		return draggable ? (
			<SortableRow
				key={board.id}
				board={board}
				locked={filter !== ""}
				className={className}
			>
				{inner}
			</SortableRow>
		) : (
			<li key={board.id} className={className}>
				{mode === "index" && <span aria-hidden className="w-4 shrink-0" />}
				{inner}
			</li>
		);
	};
	const builtInSection =
		mode === "index" && (builtIn !== undefined || pinned.length > 0) ? (
			<section aria-label="Built-in boards" className="flex flex-col">
				<h3 className="pb-1 font-medium text-muted-foreground text-xs uppercase tracking-wide">
					Built in
				</h3>
				<ul className="flex flex-col divide-y">
					{builtIn}
					{pinned.map((board) => row(board, false))}
				</ul>
			</section>
		) : null;
	const archived = boards
		.filter((each) => each.archived)
		.filter((each) => each.name.toLowerCase().includes(filter.toLowerCase()));
	const archivedSection = (
		<ArchivedBoards
			boards={archived}
			onRestore={(board) =>
				void attempt(() => actions.archiveBoard(board.id, false))
			}
		/>
	);
	const content = (
		<>
			{builtInSection}
			{mode === "index" && sortable.length > 0 && (
				<h3 className="-mb-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
					Your boards
				</h3>
			)}
			{mode !== "index" && (
				<input
					ref={field}
					value={filter}
					onChange={(event) => setFilter(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter" && shown[0]) {
							saveBoard(shown[0].id);
							onPick(shown[0].id);
							setOpen(false);
						}
					}}
					placeholder="Find a board"
					aria-label="Find a board"
					className="h-11 w-full rounded-md border bg-transparent px-3 text-base outline-none md:h-9 md:text-sm"
				/>
			)}
			<DndContext
				sensors={sensors}
				collisionDetection={closestCenter}
				modifiers={[restrictToVerticalAxis]}
				onDragEnd={reorder}
			>
				<SortableContext
					items={sortable.map((each) => each.id)}
					strategy={verticalListSortingStrategy}
				>
					<ul
						className={
							mode === "index"
								? "flex flex-col divide-y"
								: "flex max-h-72 flex-col overflow-y-auto"
						}
					>
						{sortable.length === 0 && pinned.length === 0 && (
							<li className="py-6 text-muted-foreground text-sm">
								No boards found.
							</li>
						)}
						{sortable.map((board) => row(board, true))}
					</ul>
				</SortableContext>
			</DndContext>
			{editing === "new" ? (
				<NameField initial="" onDone={(value) => void submit(value)} />
			) : (
				<button
					type="button"
					onClick={() => setEditing("new")}
					className={
						mode === "index"
							? "flex min-h-14 items-center justify-center gap-2 rounded-lg border border-dashed text-muted-foreground text-sm hover:bg-accent hover:text-foreground"
							: "flex items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-accent"
					}
				>
					<PlusIcon className="size-3.5" />
					{mode === "index" ? "Add board" : "Create board"}
				</button>
			)}
			{archivedSection}
			{refused === null ? null : (
				<p role="alert" className="text-destructive text-xs">
					{refused}
				</p>
			)}
		</>
	);
	return (
		<>
			{mode === "index" ? (
				<div className="flex flex-col gap-4">{content}</div>
			) : mode === "current" ? (
				now ? (
					management(now)
				) : null
			) : (
				<Popover
					open={open}
					onOpenChange={(next) => {
						setOpen(next);
						setFilter("");
						setEditing(null);
						setRefused(null);
					}}
				>
					<PopoverTrigger
						aria-label="Switch board"
						className="flex min-w-0 items-center gap-1 font-medium text-sm"
					>
						<span className="truncate">{now?.name ?? "Board"}</span>
						<ChevronDownIcon className="size-3.5 shrink-0 opacity-60" />
					</PopoverTrigger>
					<PopoverContent align="start" className="w-64">
						{content}
					</PopoverContent>
				</Popover>
			)}
			{mode === "current" && refused && editing === null && (
				<p role="alert" className="text-destructive text-xs">
					{refused}
				</p>
			)}
			{mode === "current" && (
				<Dialog
					open={editing !== null}
					onOpenChange={(open) => !open && setEditing(null)}
				>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>Rename board</DialogTitle>
							<DialogDescription>
								Choose a name for this board.
							</DialogDescription>
						</DialogHeader>
						<NameField
							initial={now?.name ?? ""}
							onDone={(value) => void submit(value)}
						/>
						{refused && <p role="alert">{refused}</p>}
					</DialogContent>
				</Dialog>
			)}
			<DeleteBoard
				board={deleting}
				others={ordered.filter((each) => each.id !== deleting?.id)}
				lanes={tasks.find((each) => each.id === deleting?.id)?.lanes ?? []}
				count={
					tasks.find((each) => each.id === deleting?.id)?.tasks.length ?? 0
				}
				onClose={() => setDeleting(null)}
				onArchive={(board) =>
					void attempt(() => actions.archiveBoard(board.id, true))
				}
				onDelete={(board, to, lanes) =>
					attempt(async () => {
						for (const lane of lanes) {
							await actions.moveLaneToBoard(lane, to);
						}
						await actions.dropBoard(board.id);
					})
				}
			/>
		</>
	);
}
