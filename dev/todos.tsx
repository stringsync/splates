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
	AlignLeftIcon,
	GripVerticalIcon,
	ListTodoIcon,
	Trash2Icon,
} from "lucide-react";
import {
	type FormEvent,
	type HTMLAttributes,
	type JSX,
	type KeyboardEventHandler,
	type MouseEventHandler,
	type TouchEventHandler,
	useEffect,
	useState,
} from "react";
import { Button } from "#dev/components/ui/button.tsx";
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
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from "#dev/components/ui/sheet.tsx";
import { toast } from "#dev/components/ui/toast.tsx";
import { cn } from "#dev/lib/utils.ts";
import { age } from "../age";
import type { Snapshot } from "../snapshot";
import type { TodoState } from "../todo";
import { addTodo, moveTodo, removeTodo, updateTodo } from "./api";
import { AttachButton, FileList, useFiles } from "./files";
import { MentionAnchor, useMentions } from "./mentions";

/**
 * Work deferred for later, top of the list first, and a line to add to it.
 * Picking one up takes an agent (`arbor add <task> --todo <id>`), and `merge`
 * recommends the highest open one, so the list is the priority: drag a card
 * to reorder it, or tap one to reword or remove it.
 */
export function Todos({ snapshot }: { snapshot: Snapshot }): JSX.Element {
	const { todos, todoStalenessMs } = snapshot;
	const [opened, setOpened] = useState<number | null>(null);
	const current = todos.find((todo) => todo.id === opened);
	return (
		<div className="flex flex-col gap-6">
			<Add />
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
				<Board todos={todos} staleness={todoStalenessMs} onOpen={setOpened} />
			)}
			<Sheet
				open={current !== undefined}
				onOpenChange={(open) => {
					if (!open) {
						setOpened(null);
					}
				}}
			>
				{current && <Edit todo={current} onDone={() => setOpened(null)} />}
			</Sheet>
		</div>
	);
}

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
		moveTodo(Number(active.id), to + 1).catch((error: unknown) => {
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
	const meta = [
		`#${todo.id}`,
		todo.files.length > 0
			? `${todo.files.length} file${todo.files.length === 1 ? "" : "s"}`
			: null,
		todo.takenBy ? `taken by ${todo.takenBy}` : null,
		stale ? `stale, ${age(todo.createdAt)}` : null,
	].filter(Boolean);
	return (
		<div
			className={cn(
				"group flex touch-manipulation items-stretch rounded-lg border bg-card text-card-foreground shadow-xs transition-shadow hover:shadow-sm",
				className,
			)}
		>
			<button
				type="button"
				onClick={onOpen}
				{...pointer}
				className="flex min-w-0 flex-1 cursor-grab flex-col gap-1 py-2.5 pl-3 text-left select-none active:cursor-grabbing"
			>
				<span
					className={cn(
						"text-sm",
						(todo.takenBy || stale) && "text-muted-foreground",
					)}
				>
					{todo.subject}
					{todo.text !== "" && (
						<AlignLeftIcon
							role="img"
							aria-label="has detail"
							className="ml-1.5 inline size-3.5 text-muted-foreground"
						/>
					)}
				</span>
				<span className="text-muted-foreground text-xs">
					{meta.join(" · ")}
				</span>
			</button>
			<button
				type="button"
				{...grip}
				aria-label={`move ${todo.subject}`}
				className="flex w-8 shrink-0 cursor-grab items-center justify-center rounded-r-lg text-muted-foreground opacity-40 outline-none group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring"
			>
				<GripVerticalIcon className="size-4" />
			</button>
		</div>
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
							placeholder="More to say, if any"
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

/** One todo opened: its words and files to change, and a way to drop it. */
function Edit({
	todo,
	onDone,
}: {
	todo: TodoState;
	onDone: () => void;
}): JSX.Element {
	const [subject, setSubject] = useState(todo.subject);
	const [text, setText] = useState(todo.text);
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

	const run = async (write: () => Promise<void>, failed: string) => {
		setBusy(true);
		try {
			await write();
			onDone();
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
			files.files.length > 0 ||
			files.keep.length !== todo.files.length);
	return (
		<SheetContent
			side="bottom"
			className="mx-auto max-h-[85dvh] max-w-2xl overflow-y-auto rounded-t-xl"
		>
			<SheetHeader>
				<SheetTitle>Todo {todo.id}</SheetTitle>
				<SheetDescription>
					{todo.takenBy
						? `Taken by ${todo.takenBy}`
						: `Number ${todo.position} on the list`}
				</SheetDescription>
			</SheetHeader>
			<div className="flex flex-col gap-2 px-4">
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
				<MentionAnchor mentions={detail}>
					<InputGroup>
						<InputGroupTextarea
							ref={detail.ref}
							aria-label="detail"
							placeholder="More to say, if any"
							value={text}
							onChange={detail.onChange}
							onSelect={detail.onSelect}
							onClick={detail.onClick}
							onKeyDown={detail.onKeyDown}
							onPaste={files.paste}
							rows={3}
						/>
						<InputGroupAddon align="block-end">
							<AttachButton files={files} />
						</InputGroupAddon>
					</InputGroup>
				</MentionAnchor>
				<FileList files={files} />
			</div>
			<SheetFooter className="flex-row justify-between">
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
					onClick={() =>
						void run(
							() =>
								updateTodo(todo.id, {
									subject,
									text,
									files: files.files,
									keep: files.keep,
								}),
							"Not saved",
						)
					}
				>
					Save
				</Button>
			</SheetFooter>
		</SheetContent>
	);
}
