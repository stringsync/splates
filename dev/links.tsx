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
import { Button } from "#dev/components/ui/button.tsx";
import { Input } from "#dev/components/ui/input.tsx";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#dev/components/ui/popover.tsx";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#dev/components/ui/select.tsx";
import { toast } from "#dev/components/ui/toast.tsx";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#dev/components/ui/tooltip.tsx";
import { cn } from "#dev/lib/utils.ts";
import { cycle, followers } from "../lanes";
import type { TodoState } from "../todo";
import { arrangeTodo, linkTodo } from "./api";
import { Board } from "./board";

/**
 * A write made from the dialog, with a toast when the server refuses it;
 * whether it landed.
 */
function attempt(write: Promise<void>, failed: string): Promise<boolean> {
	return write.then(
		() => true,
		(error: unknown) => {
			toast.add({
				title: failed,
				description: error instanceof Error ? error.message : String(error),
				type: "error",
			});
			return false;
		},
	);
}

/**
 * An open todo's place among the others, in a quiet row of properties under
 * its subject, the way Trello shows a card's labels: the lane it runs in,
 * what blocks it and what it blocks. Each change is made the moment it is
 * picked, and each link comes off with its own ×, so undoing one is as quick
 * as making it.
 */
export function Links({ todo }: { todo: TodoState }): JSX.Element {
	const { todos } = useContext(Board);
	const blockers = todos.filter((other) => todo.blockedBy.includes(other.id));
	const blocking = followers(todos, todo.id);
	return (
		<dl className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-1">
			<Property title="Lane">
				<LanePicker todo={todo} />
			</Property>
			<Property title="Blocked by" Icon={HourglassIcon}>
				<LinkList
					title="Blocked by"
					linked={blockers}
					onRemove={(other) =>
						attempt(
							linkTodo(
								todo.id,
								todo.blockedBy.filter((id) => id !== other.id),
							),
							"Not unlinked",
						)
					}
				/>
				<TodoPicker
					label="Add a todo blocking this one"
					exclude={[todo.id, ...todo.blockedBy]}
					loops={(other) => cycle(todos, todo.id, other.id)}
					onPick={(other) =>
						attempt(
							linkTodo(todo.id, [...todo.blockedBy, other.id]),
							"Not linked",
						)
					}
				/>
			</Property>
			<Property title="Blocking" Icon={CornerDownRightIcon}>
				<LinkList
					title="Blocking"
					linked={blocking}
					onRemove={(other) =>
						attempt(
							linkTodo(
								other.id,
								other.blockedBy.filter((id) => id !== todo.id),
							),
							"Not unlinked",
						)
					}
				/>
				<TodoPicker
					label="Add a todo this one blocks"
					exclude={[todo.id, ...blocking.map((other) => other.id)]}
					loops={(other) => cycle(todos, other.id, todo.id)}
					onPick={(other) =>
						attempt(
							linkTodo(other.id, [...other.blockedBy, todo.id]),
							"Not linked",
						)
					}
				/>
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
			<dd className="flex min-h-7 flex-wrap items-center gap-1">{children}</dd>
		</>
	);
}

/**
 * Which lane it runs in, and a way to start a new lane from it: picking "A
 * new lane…" asks for its name in place, Enter starts it, Escape keeps the
 * lane it had.
 */
function LanePicker({ todo }: { todo: TodoState }): JSX.Element {
	const { lanes } = useContext(Board);
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
					void attempt(
						arrangeTodo(todo.id, "new", undefined, name),
						"Lane not added",
					).then((added) => added && stop());
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
					className="h-7 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
				/>
				<Button type="submit" size="xs" disabled={name.trim() === ""}>
					Add lane
				</Button>
				<Button
					type="button"
					size="icon-xs"
					variant="ghost"
					aria-label="keep its lane"
					onClick={stop}
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
				attempt(
					arrangeTodo(todo.id, value === "none" ? null : Number(value)),
					"Not moved",
				);
			}}
		>
			<SelectTrigger
				size="sm"
				aria-label="lane"
				className="-ml-2 h-7 border-transparent bg-transparent px-2 shadow-none hover:bg-muted dark:bg-transparent"
			>
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
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
	linked: TodoState[];
	onRemove: (todo: TodoState) => void;
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
					className="group/link inline-flex h-6 items-center rounded-md bg-muted/70 text-sm"
				>
					<Tooltip>
						<TooltipTrigger
							render={<button type="button" />}
							onClick={() => open(other.id)}
							className="cursor-pointer rounded-md pl-2 tabular-nums outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
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
						className="flex h-full cursor-pointer items-center rounded-md px-1 text-muted-foreground/50 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring group-hover/link:text-muted-foreground"
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
	loops: (todo: TodoState) => number[] | null;
	onPick: (todo: TodoState) => void;
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
						title={label}
					/>
				}
			>
				<PlusIcon />
			</PopoverTrigger>
			<PopoverContent align="start" className="w-80 gap-2 p-2">
				<Input
					autoFocus
					aria-label="find a todo"
					placeholder="Number or words"
					value={query}
					onChange={(event) => setQuery(event.target.value)}
				/>
				<ul className="flex max-h-64 flex-col overflow-y-auto">
					{shown.length === 0 && (
						<li className="px-2 py-1.5 text-muted-foreground text-sm">
							No todo matches
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
										"flex w-full cursor-pointer items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40",
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
