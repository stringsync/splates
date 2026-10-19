import type { GoneBlocker, TaskRecord } from "@stringsync/splates-server/board";
import { cycle, followers } from "@stringsync/splates-server/board/browser";
import {
	CornerDownRightIcon,
	HourglassIcon,
	PlusIcon,
	XIcon,
} from "lucide-react";
import {
	type JSX,
	type ReactNode,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import { Button } from "#web/components/ui/button.tsx";
import { Input } from "#web/components/ui/input.tsx";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#web/components/ui/popover.tsx";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#web/components/ui/select.tsx";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#web/components/ui/tooltip.tsx";
import { cn } from "#web/lib/utils.ts";
import { arrangeTodo, linkTodo } from "./api";
import { Board } from "./board";
import { arranged, linked } from "./board-expectations";
import { useExpectSnapshot } from "./expecting";
import { Refusal, useRefusal } from "./refusal";

/**
 * An open todo's place among the others, in a quiet row of properties under
 * its subject, the way Trello shows a card's labels: the lane it runs in,
 * what blocks it and what it blocks. Each change is made the moment it is
 * picked, and each link comes off with its own ×, so undoing one is as quick
 * as making it.
 */
export function Links({ todo }: { todo: TaskRecord }): JSX.Element {
	const { todos } = useContext(Board);
	const blockers = todos.filter((other) => todo.blockedBy.includes(other.id));
	const lost = todo.blockersLost ?? [];
	// What blocks it as the server takes the whole list: those it lost stay
	// held for the person until they are left out.
	const held = [...todo.blockedBy, ...lost.map((gone) => gone.id)];
	const blocking = followers(todos, todo.id);
	// Each row says what of it was refused, under its own links.
	const lane = useRefusal();
	const blockedBy = useRefusal();
	const blocks = useRefusal();
	const expect = useExpectSnapshot();
	/** Has todo `id` blocked by `blockedBy`, shown so at once. */
	const link = (id: number, blockedBy: number[]) =>
		expect(linked(id, blockedBy), linkTodo(id, blockedBy));
	return (
		<dl className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-1">
			<Property title="Lane">
				<LanePicker todo={todo} attempt={lane.attempt} />
				<Refusal refusal={lane.refusal} className="w-full" />
			</Property>
			<Property title="Blocked by" Icon={HourglassIcon}>
				<LinkList
					title="Blocked by"
					linked={blockers}
					onRemove={(other) =>
						blockedBy.attempt(
							link(
								todo.id,
								held.filter((id) => id !== other.id),
							),
							"Not unlinked",
						)
					}
				/>
				<LostList
					lost={lost}
					onRemove={(gone) =>
						blockedBy.attempt(
							link(
								todo.id,
								held.filter((id) => id !== gone.id),
							),
							"Not let go",
						)
					}
				/>
				<TodoPicker
					label="Add a task blocking this one"
					exclude={[todo.id, ...todo.blockedBy]}
					loops={(other) => cycle(todos, todo.id, other.id)}
					onPick={(other) =>
						blockedBy.attempt(link(todo.id, [...held, other.id]), "Not linked")
					}
				/>
				<Refusal refusal={blockedBy.refusal} className="w-full" />
			</Property>
			<Property title="Blocking" Icon={CornerDownRightIcon}>
				<LinkList
					title="Blocking"
					linked={blocking}
					onRemove={(other) =>
						blocks.attempt(
							link(
								other.id,
								other.blockedBy.filter((id) => id !== todo.id),
							),
							"Not unlinked",
						)
					}
				/>
				<TodoPicker
					label="Add a task this one blocks"
					exclude={[todo.id, ...blocking.map((other) => other.id)]}
					loops={(other) => cycle(todos, other.id, todo.id)}
					onPick={(other) =>
						blocks.attempt(
							link(other.id, [...other.blockedBy, todo.id]),
							"Not linked",
						)
					}
				/>
				<Refusal refusal={blocks.refusal} className="w-full" />
			</Property>
		</dl>
	);
}

/** One property's name, muted, and its value beside it. */
function Property({
	title,
	Icon,
	children,
}: {
	title: string;
	Icon?: typeof HourglassIcon;
	children: ReactNode;
}): JSX.Element {
	return (
		<>
			<dt className="flex items-center gap-1 text-muted-foreground text-xs">
				{Icon && <Icon aria-hidden className="size-3" />}
				{title}
			</dt>
			<dd className="flex min-h-7 pointer-coarse:min-h-10 flex-wrap items-center gap-1">
				{children}
			</dd>
		</>
	);
}

/**
 * Which lane it runs in, and a way to start a new lane from it: picking "A
 * new lane…" asks for its name in place, Enter starts it, Escape keeps the
 * lane it had.
 */
function LanePicker({
	todo,
	attempt,
}: {
	todo: TaskRecord;
	/** Makes a write, saying whether it landed. */
	attempt: (write: Promise<void>, failed: string) => Promise<boolean>;
}): JSX.Element {
	const { lanes } = useContext(Board);
	const expect = useExpectSnapshot();
	const [naming, setNaming] = useState(false);
	const [name, setName] = useState("");
	const box = useRef<HTMLInputElement>(null);
	// After the select has closed, since it hands focus back to its trigger,
	// which the box has just replaced.
	useEffect(() => {
		if (!naming) {
			return;
		}
		const later = setTimeout(() => box.current?.focus());
		return () => clearTimeout(later);
	}, [naming]);
	const items = [
		{ value: "none", label: "Untriaged" },
		...lanes.map((lane) => ({ value: String(lane.id), label: lane.name })),
		{ value: "new", label: "A new lane…" },
	];
	if (naming) {
		const stop = () => {
			setNaming(false);
			setName("");
		};
		return (
			<form
				className="flex min-w-0 flex-1 items-center gap-1"
				onSubmit={(event) => {
					event.preventDefault();
					if (name.trim() === "") {
						return;
					}
					// Shown in its new lane at once; refused, the name comes back.
					stop();
					void attempt(
						expect(
							arranged(todo.id, "new", name.trim()),
							arrangeTodo(todo.id, "new", undefined, name),
						),
						"Lane not added",
					).then((added) => {
						if (!added) {
							setName(name);
							setNaming(true);
						}
					});
				}}
			>
				<input
					ref={box}
					aria-label="new lane name"
					placeholder="Name the new lane"
					value={name}
					onChange={(event) => setName(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Escape") {
							// The lane's name only, not the whole dialog.
							event.stopPropagation();
							stop();
						}
					}}
					className="h-7 pointer-coarse:h-10 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm pointer-coarse:text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
				/>
				<Button
					type="submit"
					size="xs"
					disabled={name.trim() === ""}
					className="pointer-coarse:h-10 pointer-coarse:px-3"
				>
					Add lane
				</Button>
				<Button
					type="button"
					size="icon-xs"
					variant="ghost"
					aria-label="keep its lane"
					onClick={stop}
					className="pointer-coarse:size-10"
				>
					<XIcon />
				</Button>
			</form>
		);
	}
	return (
		<Select
			items={items}
			value={todo.lane === null ? "none" : String(todo.lane)}
			onValueChange={(value) => {
				if (value === "new") {
					setNaming(true);
					return;
				}
				const lane = value === "none" ? null : Number(value);
				attempt(
					expect(arranged(todo.id, lane), arrangeTodo(todo.id, lane)),
					"Not moved",
				);
			}}
		>
			<SelectTrigger
				size="sm"
				aria-label="lane"
				className="-ml-2 h-7 pointer-coarse:h-10 border-transparent bg-transparent px-2 shadow-none hover:bg-muted dark:bg-transparent"
			>
				<SelectValue />
			</SelectTrigger>
			<SelectContent className="pointer-coarse:[&_[role=option]]:min-h-10">
				{items.map((item) => (
					<SelectItem key={item.value} value={item.value}>
						{item.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

/** What a lane is called on the board, by its number. */
function useLaneName(): (id: number) => string {
	const { lanes } = useContext(Board);
	return (id) => lanes.find((lane) => lane.id === id)?.name ?? `Lane ${id}`;
}

/**
 * The todos linked one way, a chip each: its number opens it and names it
 * in a tooltip, and its faint × unlinks it.
 */
function LinkList({
	title,
	linked,
	onRemove,
}: {
	title: string;
	linked: TaskRecord[];
	onRemove: (todo: TaskRecord) => void;
}): JSX.Element | null {
	const { open } = useContext(Board);
	const laneName = useLaneName();
	if (linked.length === 0) {
		return null;
	}
	return (
		<ul aria-label={title} className="contents">
			{linked.map((other) => (
				<li
					key={other.id}
					className="group/link inline-flex h-6 pointer-coarse:h-10 items-center rounded-md bg-muted/70 text-sm"
				>
					<Tooltip>
						<TooltipTrigger
							render={<button type="button" />}
							onClick={() => open(other.id)}
							className="cursor-pointer rounded-md pl-2 tabular-nums outline-none pointer-coarse:flex pointer-coarse:h-full pointer-coarse:items-center hover:underline focus-visible:ring-2 focus-visible:ring-ring"
						>
							#{other.id}
						</TooltipTrigger>
						<TooltipContent>
							{other.lane === null
								? other.subject
								: `${other.subject} · ${laneName(other.lane)}`}
						</TooltipContent>
					</Tooltip>
					<button
						type="button"
						aria-label={`unlink #${other.id}`}
						onClick={() => onRemove(other)}
						className="flex h-full cursor-pointer items-center rounded-md px-1 pointer-coarse:px-3 text-muted-foreground/50 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring group-hover/link:text-muted-foreground"
					>
						<XIcon className="size-3" />
					</button>
				</li>
			))}
		</ul>
	);
}

/**
 * The todos it was blocked by that were removed without merging, which hold
 * it back until the person lets each go with its ×, once it still makes
 * sense without them.
 */
function LostList({
	lost,
	onRemove,
}: {
	lost: GoneBlocker[];
	onRemove: (gone: GoneBlocker) => void;
}): JSX.Element | null {
	if (lost.length === 0) {
		return null;
	}
	return (
		<ul aria-label="Removed blockers" className="contents">
			{lost.map((gone) => (
				<li
					key={gone.id}
					className="group/link inline-flex h-6 pointer-coarse:h-10 items-center rounded-md bg-muted/70 text-sm"
				>
					<Tooltip>
						<TooltipTrigger
							render={<span />}
							className="cursor-default pl-2 text-warning tabular-nums line-through"
						>
							#{gone.id}
						</TooltipTrigger>
						<TooltipContent>
							{`${gone.subject}: removed without merging, so this waits on you. Let it go to start this anyway.`}
						</TooltipContent>
					</Tooltip>
					<button
						type="button"
						aria-label={`let go of removed #${gone.id}`}
						onClick={() => onRemove(gone)}
						className="flex h-full cursor-pointer items-center rounded-md px-1 pointer-coarse:px-3 text-muted-foreground/50 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring group-hover/link:text-muted-foreground"
					>
						<XIcon className="size-3" />
					</button>
				</li>
			))}
		</ul>
	);
}

/**
 * A search over the todos by number or words, to link one: those that would
 * make a loop are shown but cannot be picked, saying why.
 */
function TodoPicker({
	label,
	exclude,
	loops,
	onPick,
}: {
	label: string;
	exclude: number[];
	/** The loop linking `todo` would make, or null for none. */
	loops: (todo: TaskRecord) => number[] | null;
	onPick: (todo: TaskRecord) => void;
}): JSX.Element {
	const { todos } = useContext(Board);
	const laneName = useLaneName();
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const words = query.trim().toLowerCase().replace(/^#/, "");
	const shown = todos.filter(
		(other) =>
			!exclude.includes(other.id) &&
			(words === "" ||
				String(other.id).startsWith(words) ||
				other.subject.toLowerCase().includes(words)),
	);
	return (
		<Popover
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				setQuery("");
			}}
		>
			<PopoverTrigger
				render={
					<Button
						size="icon-xs"
						variant="ghost"
						aria-label={label}
						className="pointer-coarse:size-10"
						title={label}
					/>
				}
			>
				<PlusIcon />
			</PopoverTrigger>
			<PopoverContent align="start" className="w-80 gap-2 p-2">
				<Input
					autoFocus
					aria-label="find a task"
					placeholder="Number or words"
					value={query}
					onChange={(event) => setQuery(event.target.value)}
				/>
				<ul className="flex max-h-64 flex-col overflow-y-auto">
					{shown.length === 0 && (
						<li className="px-2 py-1.5 text-muted-foreground text-sm">
							No task matches
						</li>
					)}
					{shown.map((other) => {
						const loop = loops(other);
						return (
							<li key={other.id}>
								<button
									type="button"
									disabled={loop !== null}
									title={
										loop === null
											? undefined
											: `That makes a loop: ${loop.map((id) => `#${id}`).join(" → ")}`
									}
									onClick={() => {
										onPick(other);
										setOpen(false);
									}}
									className={cn(
										"flex w-full pointer-coarse:min-h-10 cursor-pointer items-baseline pointer-coarse:items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40",
									)}
								>
									<span className="text-muted-foreground tabular-nums">
										#{other.id}
									</span>
									<span className="min-w-0 flex-1 truncate">
										{other.subject}
									</span>
									{other.lane !== null && (
										<span className="shrink-0 text-muted-foreground text-xs">
											{laneName(other.lane)}
										</span>
									)}
								</button>
							</li>
						);
					})}
				</ul>
			</PopoverContent>
		</Popover>
	);
}
