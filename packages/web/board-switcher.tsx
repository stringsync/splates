import type { BoardRecord, TaskRecord } from "@splates/server/board/browser";
import { ChevronDownIcon, PlusIcon, StarIcon } from "lucide-react";
import { type JSX, useEffect, useRef, useState } from "react";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#web/components/ui/popover.tsx";
import { cn } from "#web/lib/utils.ts";
import { addBoard, renameBoard } from "./api";
import {
	recentBoards,
	saveBoard,
	starredBoards,
	toggleStar,
} from "./board-places";

/** A board's lanes' tasks, as the switcher counts them. */
export interface BoardTasks {
	id: number;
	tasks: TaskRecord[];
}

/**
 * The top bar's board switcher: names the current board and opens a list of
 * the project's boards, starred and recent first, each with its task count and
 * a dot when something there needs a look, with Create and Rename board. Typing
 * filters; `b` opens it.
 */
export function BoardSwitcher({
	boards,
	current,
	tasks,
	onPick,
}: {
	boards: BoardRecord[];
	current: number;
	tasks: BoardTasks[];
	onPick: (id: number) => void;
}): JSX.Element {
	const [open, setOpen] = useState(false);
	const [filter, setFilter] = useState("");
	const [stars, setStars] = useState(starredBoards);
	const [editing, setEditing] = useState<number | "new" | null>(null);
	const [refused, setRefused] = useState<string | null>(null);
	const field = useRef<HTMLInputElement>(null);
	const live = boards.filter((each) => !each.archived);
	const now = live.find((each) => each.id === current) ?? live[0];

	useEffect(() => {
		const key = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			if (
				event.key !== "b" ||
				event.metaKey ||
				event.ctrlKey ||
				event.altKey ||
				target?.closest("input, textarea, select, [contenteditable]")
			) {
				return;
			}
			event.preventDefault();
			setOpen(true);
		};
		window.addEventListener("keydown", key);
		return () => window.removeEventListener("keydown", key);
	}, []);

	const recent = recentBoards();
	const rank = (board: BoardRecord) => {
		if (stars.includes(board.id)) {
			return 0;
		}
		const at = recent.indexOf(board.id);
		return at === -1 ? 2 : 1;
	};
	const shown = live
		.filter((each) => each.name.toLowerCase().includes(filter.toLowerCase()))
		.sort(
			(left, right) =>
				rank(left) - rank(right) ||
				(rank(left) === 1
					? recent.indexOf(left.id) - recent.indexOf(right.id)
					: 0) ||
				left.position - right.position,
		);
	const submit = async (value: string) => {
		const name = value.trim();
		const target = editing;
		setEditing(null);
		if (name === "" || target === null) {
			return;
		}
		try {
			if (target === "new") {
				await addBoard(name);
			} else {
				await renameBoard(target, name);
			}
			setRefused(null);
		} catch (error) {
			setRefused(error instanceof Error ? error.message : "Not saved");
			setEditing(target);
		}
	};

	return (
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
				<input
					ref={field}
					value={filter}
					onChange={(event) => setFilter(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter" && shown[0]) {
							onPick(shown[0].id);
							saveBoard(shown[0].id);
							setOpen(false);
						}
					}}
					placeholder="Find a board"
					aria-label="Find a board"
					className="w-full rounded-md border bg-transparent px-2 py-1 text-sm outline-none"
				/>
				<ul className="flex max-h-72 flex-col overflow-y-auto">
					{shown.map((board) => {
						const own = tasks.find((each) => each.id === board.id)?.tasks ?? [];
						const starred = stars.includes(board.id);
						return (
							<li key={board.id} className="group flex items-center gap-1">
								{editing === board.id ? (
									<NameField
										initial={board.name}
										onDone={(value) => void submit(value)}
									/>
								) : (
									<button
										type="button"
										onClick={() => {
											onPick(board.id);
											saveBoard(board.id);
											setOpen(false);
										}}
										className={cn(
											"flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-accent",
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
										<span className="ml-auto text-muted-foreground text-xs">
											{own.length}
										</span>
									</button>
								)}
								<button
									type="button"
									aria-label={starred ? "Unstar board" : "Star board"}
									onClick={() => setStars(toggleStar(board.id))}
									className="p-1"
								>
									<StarIcon
										className={cn("size-3.5", starred && "fill-current")}
									/>
								</button>
								<button
									type="button"
									className="px-1 text-muted-foreground text-xs"
									onClick={() => setEditing(board.id)}
								>
									Rename
								</button>
							</li>
						);
					})}
				</ul>
				{editing === "new" ? (
					<NameField initial="" onDone={(value) => void submit(value)} />
				) : (
					<button
						type="button"
						onClick={() => setEditing("new")}
						className="flex items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-accent"
					>
						<PlusIcon className="size-3.5" />
						Create board
					</button>
				)}
				{refused === null ? null : (
					<p role="alert" className="text-destructive text-xs">
						{refused}
					</p>
				)}
			</PopoverContent>
		</Popover>
	);
}

/** A board's name being typed: Enter saves it, Escape drops it. */
function NameField({
	initial,
	onDone,
}: {
	initial: string;
	onDone: (value: string) => void;
}): JSX.Element {
	return (
		<input
			// biome-ignore lint/a11y/noAutofocus: opened by the person's click on Create or Rename
			autoFocus
			defaultValue={initial}
			aria-label="Board name"
			placeholder="Board name"
			onKeyDown={(event) => {
				if (event.key === "Enter") {
					onDone(event.currentTarget.value);
				}
				if (event.key === "Escape") {
					onDone("");
				}
			}}
			className="min-w-0 flex-1 rounded-md border bg-transparent px-2 py-1 text-sm outline-none"
		/>
	);
}

/** Whether a task there needs a look: one running or blocked. */
function needsLook(task: TaskRecord): boolean {
	return task.stage === "running" || task.blockedBy.length > 0;
}
