import {
	closestCenter,
	DndContext,
	type DragEndEvent,
	DragOverlay,
	KeyboardSensor,
	MouseSensor,
	TouchSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	restrictToParentElement,
	restrictToVerticalAxis,
} from "@dnd-kit/modifiers";
import {
	arrayMove,
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
	ArrowDownToLineIcon,
	ArrowUpToLineIcon,
	ClockIcon,
	GitBranchIcon,
	GripVerticalIcon,
	LinkIcon,
	ListTodoIcon,
	type LucideIcon,
	PaperclipIcon,
	TagIcon,
	Trash2Icon,
} from "lucide-react";
import {
	createContext,
	type FormEvent,
	Fragment,
	type HTMLAttributes,
	type JSX,
	type KeyboardEventHandler,
	type MouseEventHandler,
	type ReactNode,
	type TouchEventHandler,
	useContext,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import { Button } from "#dev/components/ui/button.tsx";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#dev/components/ui/dialog.tsx";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "#dev/components/ui/empty.tsx";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupInput,
	InputGroupTextarea,
} from "#dev/components/ui/input-group.tsx";
import { Kbd } from "#dev/components/ui/kbd.tsx";
import { toast } from "#dev/components/ui/toast.tsx";
import { cn } from "#dev/lib/utils.ts";
import { age } from "../age";
import type { Snapshot } from "../snapshot";
import type { TodoState } from "../todo";
import { addTodo, moveTodo, removeTodo, updateTodo } from "./api";
import { AttachButton, FileList, useFiles } from "./files";
import { Markdown } from "./markdown";
import { MentionAnchor, useMentions } from "./mentions";
import { TagFilter } from "./tags";
import { Task } from "./tasks";

/**
 * Work deferred for later, top of the list first, and a line to add to it.
 * Picking one up takes an agent (`arbor add <task> --todo <id>`), and `merge`
 * recommends the highest open one, so the list is the priority: drag a card
 * to reorder it, or tap one to reword, move or remove it. `o` opens the top
 * one, and the open one's keys step through the rest.
 */
export function Todos({ snapshot }: { snapshot: Snapshot }): JSX.Element {
	const { todoStalenessMs, tasks } = snapshot;
	const [picked, setPicked] = useState<string | null>(null);
	const tags = [...new Set(snapshot.todos.flatMap((todo) => todo.tags))].sort();
	// A tag whose last todo went has nothing left to show, and lets go.
	const tag = picked !== null && tags.includes(picked) ? picked : null;
	const todos = snapshot.todos.filter(
		(todo) => tag === null || todo.tags.includes(tag),
	);
	const [opened, setOpened] = useState<number | null>(null);
	const at = todos.findIndex((todo) => todo.id === opened);
	const current = todos[at];
	const previous = current && todos[at - 1];
	const next = current && todos[at + 1];
	// The bottom of the whole list, not just of the todos a tag shows.
	const last = Math.max(0, ...snapshot.todos.map((todo) => todo.position));
	const [openedTask, setOpenedTask] = useState<string | null>(null);
	const task = tasks.find((found) => found.task === openedTask);
	// Only a task the page knows of opens: one merged a moment ago has no
	// details left to show.
	const openTask = (name: string) =>
		tasks.some((found) => found.task === name) ? setOpenedTask(name) : null;
	const popup = useRef<HTMLDivElement>(null);
	const [keysShown, setKeysShown] = useState(false);
	// Only over the bare list: an open todo has keys of its own.
	const bare = current === undefined && task === undefined && !keysShown;
	useKeys({
		o: () => {
			const top = todos[0];
			if (!bare || top === undefined) {
				return false;
			}
			setOpened(top.id);
			return true;
		},
		"?": () => {
			if (!bare) {
				return false;
			}
			setKeysShown(true);
			return true;
		},
	});
	return (
		<OpenTask value={openTask}>
			<FilterTag value={setPicked}>
				<div className="flex flex-col gap-6">
					<Add />
					{tags.length > 0 && (
						<TagFilter
							tags={tags}
							todos={snapshot.todos}
							selected={tag}
							onSelect={setPicked}
						/>
					)}
					{todos.length > 0 && (
						<Hint className="-mb-4 self-end">
							<Kbd>o</Kbd> opens the top todo
						</Hint>
					)}
					{todos.length === 0 ? (
						<Empty>
							<EmptyHeader>
								<EmptyMedia variant="icon">
									<ListTodoIcon />
								</EmptyMedia>
								<EmptyTitle>Nothing deferred</EmptyTitle>
								<EmptyDescription>
									Agents add what comes up outside their task here.
								</EmptyDescription>
							</EmptyHeader>
						</Empty>
					) : (
						<Board
							todos={todos}
							staleness={todoStalenessMs}
							onOpen={setOpened}
						/>
					)}
					<Dialog
						open={current !== undefined}
						onOpenChange={(open) => {
							if (!open) {
								setOpened(null);
							}
						}}
					>
						{current && (
							// Held here rather than in Edit, so stepping to another todo
							// swaps what the dialog shows without opening it again.
							<DialogContent
								ref={popup}
								// The dialog itself, not its subject: a key pressed on
								// opening is a shortcut, and a click into a field starts
								// typing.
								initialFocus={popup}
								className="max-h-[85dvh] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-lg"
							>
								{/* Keyed, so stepping to another todo starts on its own
								    words. */}
								<Edit
									key={current.id}
									todo={current}
									last={last}
									previous={previous && (() => setOpened(previous.id))}
									next={next && (() => setOpened(next.id))}
									onDone={() => setOpened(null)}
								/>
							</DialogContent>
						)}
					</Dialog>
					<Dialog open={keysShown} onOpenChange={setKeysShown}>
						<Shortcuts />
					</Dialog>
					<Dialog
						open={task !== undefined}
						onOpenChange={(open) => {
							if (!open) {
								setOpenedTask(null);
							}
						}}
					>
						{task && <Task task={task} />}
					</Dialog>
				</div>
			</FilterTag>
		</OpenTask>
	);
}

/**
 * Answers single keys pressed anywhere on the page but a text field, where
 * they are typing. Each run says whether it used the press, which then goes
 * no further.
 */
function useKeys(keys: Record<string, () => boolean>): void {
	useEffect(() => {
		const press = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			if (
				event.altKey ||
				event.ctrlKey ||
				event.metaKey ||
				target?.closest("input, textarea, [contenteditable]")
			) {
				return;
			}
			if (keys[event.key]?.()) {
				event.preventDefault();
			}
		};
		window.addEventListener("keydown", press);
		return () => window.removeEventListener("keydown", press);
	});
}

/** Every key the page answers, for `?` to list. */
const shortcuts: { keys: string[]; does: string }[] = [
	{ keys: ["o"], does: "Open the top todo" },
	{ keys: ["[", "]"], does: "Open the previous or next todo" },
	{ keys: ["{", "}"], does: "Move the open todo to the top or bottom" },
	{ keys: ["?"], does: "Show these shortcuts" },
];

function Shortcuts(): JSX.Element {
	return (
		<DialogContent>
			<DialogHeader>
				<DialogTitle>Keyboard shortcuts</DialogTitle>
				<DialogDescription>Anywhere but a text field.</DialogDescription>
			</DialogHeader>
			<dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2">
				{shortcuts.map(({ keys, does }) => (
					<Fragment key={does}>
						<dt className="flex gap-1">
							{keys.map((key) => (
								<Kbd key={key}>{key}</Kbd>
							))}
						</dt>
						<dd>{does}</dd>
					</Fragment>
				))}
			</dl>
		</DialogContent>
	);
}

/** Words about a shortcut, shown only where there is a keyboard to press it. */
function Hint({
	className,
	children,
}: {
	className?: string;
	children: ReactNode;
}): JSX.Element {
	return (
		<span
			className={cn(
				"hidden items-center gap-1.5 text-muted-foreground text-xs pointer-fine:inline-flex",
				className,
			)}
		>
			{children}
		</span>
	);
}

/** Shows only one tag's todos, from a tag on any card. */
const FilterTag = createContext<(tag: string) => void>(() => {});

/** Opens the task a card names, from wherever the card is drawn. */
const OpenTask = createContext<(task: string) => void>(() => {});

/**
 * The todos as cards in a column, each dragged to where it belongs. A mouse
 * drags once it moves a few pixels and a finger after a short press, so a
 * tap still opens the card and a swipe still scrolls; a keyboard picks one
 * up by its grip with Space and moves it with the arrows.
 */
function Board({
	todos,
	staleness,
	onOpen,
}: {
	todos: TodoState[];
	staleness: number;
	onOpen: (id: number) => void;
}): JSX.Element {
	// The order just dropped, shown until the server's catches up, so a card
	// lands where it was let go instead of jumping back for a poll.
	const [dropped, setDropped] = useState<number[] | null>(null);
	const [dragging, setDragging] = useState<number | null>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: any new snapshot is the server's word
	useEffect(() => setDropped(null), [todos]);
	const sensors = useSensors(
		useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
		useSensor(TouchSensor, {
			activationConstraint: { delay: 200, tolerance: 6 },
		}),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);
	const ids = dropped ?? todos.map((todo) => todo.id);
	const shown = ids.flatMap((id) => todos.filter((todo) => todo.id === id));
	const lifted = todos.find((todo) => todo.id === dragging);

	const drop = ({ active, over }: DragEndEvent) => {
		setDragging(null);
		if (over === null || active.id === over.id) {
			return;
		}
		const to = ids.indexOf(Number(over.id));
		setDropped(arrayMove(ids, ids.indexOf(Number(active.id)), to));
		// The place of the card it landed on, which is not its index when the
		// list shows only one tag's todos.
		const position =
			todos.find((todo) => todo.id === Number(over.id))?.position ?? to + 1;
		moveTodo(Number(active.id), position).catch((error: unknown) => {
			setDropped(null);
			toast.add({
				title: "Not moved",
				description: error instanceof Error ? error.message : String(error),
				type: "error",
			});
		});
	};

	return (
		<DndContext
			sensors={sensors}
			collisionDetection={closestCenter}
			modifiers={[restrictToVerticalAxis, restrictToParentElement]}
			onDragStart={({ active }) => setDragging(Number(active.id))}
			onDragCancel={() => setDragging(null)}
			onDragEnd={drop}
		>
			<SortableContext items={ids} strategy={verticalListSortingStrategy}>
				<ul aria-label="todos" className="flex flex-col gap-2">
					{shown.map((todo) => (
						<Sortable
							key={todo.id}
							todo={todo}
							staleness={staleness}
							onOpen={() => onOpen(todo.id)}
						/>
					))}
				</ul>
			</SortableContext>
			{/* Lifted off the column, tilted, the way a card in hand looks. */}
			<DragOverlay>
				{lifted && (
					<Card
						todo={lifted}
						staleness={staleness}
						className="rotate-2 cursor-grabbing shadow-lg"
					/>
				)}
			</DragOverlay>
		</DndContext>
	);
}

/** One card in the column, holding its place while another is dragged over it. */
function Sortable({
	todo,
	staleness,
	onOpen,
}: {
	todo: TodoState;
	staleness: number;
	onOpen: () => void;
}): JSX.Element {
	const {
		attributes,
		listeners,
		setNodeRef,
		setActivatorNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id: todo.id });
	return (
		<li
			ref={setNodeRef}
			style={{ transform: CSS.Translate.toString(transform), transition }}
		>
			<Card
				todo={todo}
				staleness={staleness}
				onOpen={onOpen}
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
						"border-dashed bg-muted shadow-none *:invisible hover:shadow-none",
				)}
			/>
		</li>
	);
}

function Card({
	todo,
	staleness,
	onOpen,
	pointer,
	grip,
	className,
}: {
	todo: TodoState;
	staleness: number;
	onOpen?: () => void;
	pointer?: HTMLAttributes<HTMLElement>;
	grip?: HTMLAttributes<HTMLButtonElement> & {
		ref?: (element: HTMLElement | null) => void;
	};
	className?: string;
}): JSX.Element {
	const stale =
		todo.takenBy === null &&
		Date.now() - Date.parse(todo.createdAt) > staleness;
	return (
		<div
			{...pointer}
			className={cn(
				// A pointer, since a tap opens it; a drag from anywhere still moves
				// it, and the grip says so with its own cursor.
				"group relative flex cursor-pointer touch-manipulation items-stretch rounded-lg border bg-card text-card-foreground shadow-xs transition-[background-color,border-color,box-shadow] select-none hover:border-foreground/25 hover:bg-muted/70 hover:shadow-sm",
				// Taken: a task is at work on it, which should read from across
				// the room.
				todo.takenBy && "border-l-4 border-l-success",
				className,
			)}
		>
			<div
				className={cn(
					"flex min-w-0 flex-1 flex-col gap-1.5 py-2.5 pl-3",
					stale && "opacity-60",
				)}
			>
				{/* Stretched over the whole card, so a tap anywhere opens it; the
				    buttons on top of it keep their own. */}
				<button
					type="button"
					onClick={onOpen}
					className="cursor-pointer text-left font-semibold text-sm outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring"
				>
					{todo.subject}
				</button>
				{todo.text !== "" && (
					<Markdown
						text={todo.text}
						preview
						className="text-muted-foreground text-xs"
					/>
				)}
				{/* Badges, the way a Trello card has them: only what there is. */}
				<span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs">
					<CopyLink id={todo.id} />
					{todo.files.length > 0 && (
						<Badge Icon={PaperclipIcon} label="files">
							{todo.files.length}
						</Badge>
					)}
					{todo.takenBy && <TakenBy task={todo.takenBy} />}
					{todo.tags.map((tag) => (
						<TagButton key={tag} tag={tag} />
					))}
					{stale && (
						<Badge Icon={ClockIcon} label="stale">
							stale, {age(todo.createdAt)}
						</Badge>
					)}
				</span>
			</div>
			<button
				type="button"
				{...grip}
				aria-label={`move ${todo.subject}`}
				className="relative flex w-8 shrink-0 cursor-grab items-center active:cursor-grabbing justify-center rounded-r-lg text-muted-foreground opacity-40 outline-none group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring"
			>
				<GripVerticalIcon className="size-4" />
			</button>
		</div>
	);
}

/**
 * The task that took the todo, green so it reads from across the room. A tap
 * opens the task; like the copy link, it sits above the card's own button and
 * never starts a drag.
 */
function TakenBy({ task }: { task: string }): JSX.Element {
	const openTask = useContext(OpenTask);
	return (
		<button
			type="button"
			onClick={() => openTask(task)}
			onMouseDown={(event) => event.stopPropagation()}
			onTouchStart={(event) => event.stopPropagation()}
			className="relative inline-flex min-w-0 cursor-pointer items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 font-medium text-success outline-none hover:bg-success/25 focus-visible:ring-2 focus-visible:ring-ring"
		>
			<GitBranchIcon
				aria-label="taken by"
				role="img"
				className="size-3.5 shrink-0"
			/>
			<span className="truncate">Taken by {task}</span>
		</button>
	);
}

/** One of a card's tags, which shows only that tag's todos when tapped. */
function TagButton({ tag }: { tag: string }): JSX.Element {
	const filter = useContext(FilterTag);
	return (
		<button
			type="button"
			aria-label={`show only ${tag}`}
			onClick={() => filter(tag)}
			onMouseDown={(event) => event.stopPropagation()}
			onTouchStart={(event) => event.stopPropagation()}
			className="relative inline-flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 outline-none hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
		>
			<TagIcon aria-hidden className="size-3" />
			{tag}
		</button>
	);
}

/** What a chat with an agent takes to mean this todo. */
function todoReference(id: number): string {
	return `[ARBOR TODO #${id}]`;
}

/**
 * The card's id, which copies `todoReference` for pasting into a chat. Above
 * the card's own button, and never the start of a drag.
 */
function CopyLink({ id }: { id: number }): JSX.Element {
	const copy = async () => {
		try {
			await navigator.clipboard.writeText(todoReference(id));
			toast.add({ title: `Copied ${todoReference(id)}` });
		} catch (error) {
			toast.add({
				title: "Not copied",
				description: error instanceof Error ? error.message : String(error),
				type: "error",
			});
		}
	};
	return (
		<button
			type="button"
			aria-label={`copy a link to todo ${id}`}
			onClick={() => void copy()}
			onMouseDown={(event) => event.stopPropagation()}
			onTouchStart={(event) => event.stopPropagation()}
			className="relative -mx-1 inline-flex cursor-pointer items-center gap-1 rounded px-1 tabular-nums outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
		>
			<LinkIcon className="size-3.5" />#{id}
		</button>
	);
}

/** One fact about a card, after an icon that says what kind. */
function Badge({
	Icon,
	label,
	children,
}: {
	Icon: LucideIcon;
	label: string;
	children: ReactNode;
}): JSX.Element {
	return (
		<span className="inline-flex items-center gap-1" title={label}>
			<Icon aria-label={label} role="img" className="size-3.5" />
			{children}
		</span>
	);
}

function Add(): JSX.Element {
	const [subject, setSubject] = useState("");
	const [text, setText] = useState("");
	const files = useFiles();
	const mentions = useMentions<HTMLInputElement>({
		task: "",
		text: subject,
		setText: setSubject,
	});
	const detail = useMentions<HTMLTextAreaElement>({ task: "", text, setText });
	const [sending, setSending] = useState(false);

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (subject.trim() === "" || sending) {
			return;
		}
		setSending(true);
		try {
			await addTodo({ subject, text }, files.files);
			setSubject("");
			setText("");
			files.clear();
		} catch (error) {
			toast.add({
				title: "Not added",
				description: error instanceof Error ? error.message : String(error),
				type: "error",
			});
		} finally {
			setSending(false);
		}
	};

	return (
		<form onSubmit={submit} className="flex flex-col gap-2">
			<MentionAnchor mentions={mentions}>
				<InputGroup>
					<InputGroupInput
						ref={mentions.ref}
						aria-label="new todo"
						placeholder="Something to do later, @ for a file"
						value={subject}
						onChange={mentions.onChange}
						onSelect={mentions.onSelect}
						onClick={mentions.onClick}
						onKeyDown={mentions.onKeyDown}
						onPaste={files.paste}
					/>
					<InputGroupAddon align="inline-end">
						<AttachButton files={files} />
						<InputGroupButton
							type="submit"
							variant="secondary"
							disabled={subject.trim() === "" || sending}
						>
							Add
						</InputGroupButton>
					</InputGroupAddon>
				</InputGroup>
			</MentionAnchor>
			{/* Only once there is a line to add to, so the box stays one line. */}
			{(subject !== "" || text !== "") && (
				<MentionAnchor mentions={detail}>
					<InputGroup>
						<InputGroupTextarea
							ref={detail.ref}
							aria-label="new todo detail"
							placeholder="More to say in markdown, if any"
							value={text}
							onChange={detail.onChange}
							onSelect={detail.onSelect}
							onClick={detail.onClick}
							onKeyDown={detail.onKeyDown}
							onPaste={files.paste}
							rows={2}
						/>
					</InputGroup>
				</MentionAnchor>
			)}
			<FileList files={files} />
		</form>
	);
}

/**
 * One todo opened: its words and files to change, a way to send it to the top
 * or bottom of the list, a way to drop it, and a step to the todo above or
 * below it.
 */
function Edit({
	todo,
	last,
	previous,
	next,
	onDone,
}: {
	todo: TodoState;
	/** The bottom position of the whole list. */
	last: number;
	/** Opens the todo above this one, when the list shows one. */
	previous?: () => void;
	/** Opens the todo below this one, when the list shows one. */
	next?: () => void;
	onDone: () => void;
}): JSX.Element {
	const [subject, setSubject] = useState(todo.subject);
	const [text, setText] = useState(todo.text);
	const [tags, setTags] = useState(todo.tags.join(", "));
	const tagsHint = useId();
	const tagged = tags
		.split(",")
		.map((tag) => tag.trim())
		.filter(Boolean);
	// Read first when there is something to read, the way a Trello card opens.
	const [writing, setWriting] = useState(todo.text === "");
	const files = useFiles(todo.files);
	const mentions = useMentions<HTMLInputElement>({
		task: "",
		text: subject,
		setText: setSubject,
	});
	const detail = useMentions<HTMLTextAreaElement>({ task: "", text, setText });
	const [busy, setBusy] = useState(false);
	// Removing cannot be taken back, so it asks twice.
	const [confirming, setConfirming] = useState(false);

	const run = async (
		write: () => Promise<void>,
		failed: string,
		then = onDone,
	) => {
		setBusy(true);
		try {
			await write();
			then();
		} catch (error) {
			toast.add({
				title: failed,
				description: error instanceof Error ? error.message : String(error),
				type: "error",
			});
			setBusy(false);
		}
	};

	const changed =
		subject.trim() !== "" &&
		(subject.trim() !== todo.subject ||
			text.trim() !== todo.text ||
			tagged.join(",") !== todo.tags.join(",") ||
			files.files.length > 0 ||
			files.keep.length !== todo.files.length);
	const save = (position?: number) =>
		updateTodo(todo.id, {
			subject,
			text,
			position,
			tags: tagged,
			files: files.files,
			keep: files.keep,
		});

	// Moving it is done with it, the way saving is: the list shows where it
	// went. Words changed on the way go with it, in the one write.
	const canMoveUp = !busy && todo.position > 1;
	const canMoveDown = !busy && todo.position < last;
	const move = (position: number): boolean => {
		if (position < todo.position ? !canMoveUp : !canMoveDown) {
			return false;
		}
		void run(
			() => (changed ? save(position) : moveTodo(todo.id, position)),
			"Not moved",
		);
		return true;
	};
	// Stepping away saves first, so nothing typed is lost on the way.
	const step = (to: (() => void) | undefined): boolean => {
		if (to === undefined || busy) {
			return false;
		}
		if (changed) {
			void run(() => save(), "Not saved", to);
		} else {
			to();
		}
		return true;
	};
	useKeys({
		"[": () => step(previous),
		"]": () => step(next),
		"{": () => move(1),
		"}": () => move(last),
	});
	return (
		<>
			<DialogHeader>
				<DialogTitle className="flex items-center gap-2">
					Todo {todo.id}
					<span className="font-normal text-muted-foreground text-xs">
						<CopyLink id={todo.id} />
					</span>
				</DialogTitle>
				<div className="flex items-center justify-between gap-2">
					<DialogDescription>
						{todo.takenBy
							? `Taken by ${todo.takenBy}`
							: `Position ${todo.position}`}
					</DialogDescription>
					<div className="flex gap-1">
						<Button
							size="xs"
							variant="ghost"
							disabled={!canMoveUp}
							onClick={() => move(1)}
						>
							<ArrowUpToLineIcon data-icon="inline-start" />
							Move to top
						</Button>
						<Button
							size="xs"
							variant="ghost"
							disabled={!canMoveDown}
							onClick={() => move(last)}
						>
							<ArrowDownToLineIcon data-icon="inline-start" />
							Move to bottom
						</Button>
					</div>
				</div>
			</DialogHeader>
			<div className="flex flex-col gap-2">
				<MentionAnchor mentions={mentions}>
					<InputGroup>
						<InputGroupInput
							ref={mentions.ref}
							aria-label="subject"
							value={subject}
							onChange={mentions.onChange}
							onSelect={mentions.onSelect}
							onClick={mentions.onClick}
							onKeyDown={mentions.onKeyDown}
							onPaste={files.paste}
						/>
					</InputGroup>
				</MentionAnchor>
				<div className="flex items-center justify-between">
					<div className="flex gap-1">
						<Button
							size="xs"
							variant={writing ? "secondary" : "ghost"}
							aria-pressed={writing}
							onClick={() => setWriting(true)}
						>
							Write
						</Button>
						<Button
							size="xs"
							variant={writing ? "ghost" : "secondary"}
							aria-pressed={!writing}
							onClick={() => setWriting(false)}
						>
							Preview
						</Button>
					</div>
					<span className="text-muted-foreground text-xs">
						Markdown supported
					</span>
				</div>
				{writing ? (
					<MentionAnchor mentions={detail}>
						<InputGroup>
							<InputGroupTextarea
								ref={detail.ref}
								aria-label="detail"
								placeholder="More to say in markdown, if any"
								value={text}
								onChange={detail.onChange}
								onSelect={detail.onSelect}
								onClick={detail.onClick}
								onKeyDown={detail.onKeyDown}
								onPaste={files.paste}
								rows={6}
							/>
							<InputGroupAddon align="block-end">
								<AttachButton files={files} />
							</InputGroupAddon>
						</InputGroup>
					</MentionAnchor>
				) : (
					<div className="min-h-20 rounded-md border px-3 py-2 text-sm">
						{text.trim() === "" ? (
							<span className="text-muted-foreground">Nothing to preview</span>
						) : (
							<Markdown text={text} />
						)}
					</div>
				)}
				<FileList files={files} />
				<div className="flex flex-col gap-1">
					<InputGroup>
						<InputGroupAddon>
							<TagIcon />
						</InputGroupAddon>
						<InputGroupInput
							aria-label="tags"
							aria-describedby={tagsHint}
							// Says what the field is for: example tags read as ones already set.
							placeholder="Words that group related todos"
							value={tags}
							onChange={(event) => setTags(event.target.value)}
						/>
					</InputGroup>
					{/* Always shown, since the placeholder goes once a tag is typed. */}
					<p id={tagsHint} className="text-muted-foreground text-xs">
						Separate tags with commas.
					</p>
				</div>
			</div>
			<DialogFooter className="flex-row justify-between sm:justify-between">
				<Button
					variant={confirming ? "destructive" : "ghost"}
					disabled={busy}
					onClick={() =>
						confirming
							? void run(() => removeTodo(todo.id), "Not removed")
							: setConfirming(true)
					}
				>
					<Trash2Icon data-icon="inline-start" />
					{confirming ? "Remove for good" : "Remove"}
				</Button>
				<Button
					disabled={!changed || busy}
					onClick={() => void run(() => save(), "Not saved")}
				>
					Save
				</Button>
			</DialogFooter>
		</>
	);
}
