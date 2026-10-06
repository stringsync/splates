import { useDroppable } from "@dnd-kit/core";
import {
	SortableContext,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useReactive } from "@webappwiz/react";
import {
	ChevronDownIcon,
	Columns3Icon,
	CopyIcon,
	EyeIcon,
	EyeOffIcon,
	GitBranchIcon,
	MergeIcon,
	MoreHorizontalIcon,
	PencilIcon,
	PlusIcon,
	Undo2Icon,
	XIcon,
} from "lucide-react";
import {
	type FormEvent,
	type JSX,
	type KeyboardEvent,
	type ReactNode,
	useContext,
	useState,
} from "react";
import { Button } from "#dev/components/ui/button.tsx";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#dev/components/ui/dropdown-menu.tsx";
import { toast } from "#dev/components/ui/toast.tsx";
import { cn } from "#dev/lib/utils.ts";
import type { LaneState } from "../lanes";
import type { TodoState } from "../todo";
import { addLane, dropLane, joinLanes, renameLane } from "./api";
import { Board, still } from "./board";
import { copy, laneReference, Sortable } from "./card";
import { AttachButton, FileList } from "./files";
import { MentionAnchor, useMentions } from "./mentions";
import { TodoDraft } from "./todo-draft";

/** A write from a column, with a toast when the server refuses it. */
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

/** Where a column takes a dropped card: its id among the cards' numbers. */
export function columnId(lane: number | null | "new"): string {
	return `lane:${lane ?? "none"}`;
}

/** The column a `columnId` names, or undefined for a card's number. */
export function columnOf(
	id: string | number,
): number | null | "new" | undefined {
	if (typeof id === "number" || !id.startsWith("lane:")) {
		return undefined;
	}
	const lane = id.slice("lane:".length);
	return lane === "none" ? null : lane === "new" ? "new" : Number(lane);
}

/**
 * A column a card can be dropped on, lit while one is over it: the cards in
 * it are their own targets, and the rest of it means the bottom. Every
 * column is a Trello list: a header, its cards, and a way to add one.
 */
function Column({
	lane,
	label,
	children,
}: {
	lane: number | null;
	label: string;
	children: ReactNode;
}): JSX.Element {
	const { setNodeRef, isOver } = useDroppable({ id: columnId(lane) });
	return (
		<section
			ref={setNodeRef}
			aria-label={label}
			className={cn(
				"flex max-h-[calc(100dvh-6rem)] w-72 shrink-0 snap-start flex-col gap-1.5 rounded-xl bg-muted/40 p-2 transition-colors dark:bg-muted/20",
				isOver && "bg-primary/5 ring-1 ring-primary/30",
			)}
		>
			{children}
		</section>
	);
}

/** A column's cards, top first, each a drag handle and a drop target. */
function Cards({
	todos,
	label,
	staleness,
	steps,
}: {
	todos: TodoState[];
	label: string;
	staleness: number;
	/** Number the cards, as a lane's steps are. */
	steps: boolean;
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
			</ol>
		</SortableContext>
	);
}

/**
 * The first column: every todo in no lane, where new ones land until someone
 * puts them in a lane.
 */
export function Untriaged({
	todos,
	staleness,
}: {
	/** Every untriaged todo. */
	todos: TodoState[];
	staleness: number;
}): JSX.Element {
	const board = useContext(Board);
	return (
		<Column lane={null} label="Untriaged">
			<header className="flex flex-col gap-1 px-1 pt-1">
				<h3 className="flex items-baseline gap-1.5 font-medium text-sm">
					Untriaged
					<span className="font-normal text-muted-foreground text-xs tabular-nums">
						{todos.length}
					</span>
				</h3>
				<p className="text-muted-foreground text-xs">Not in a lane yet.</p>
			</header>
			<Cards
				todos={todos}
				label="Untriaged todos"
				staleness={staleness}
				steps={false}
			/>
			{board.todos.length === 0 && (
				<p className="px-1 py-2 text-muted-foreground text-xs">
					Nothing to do yet. Agents add what comes up outside their task here.
				</p>
			)}
			<AddTodo lane={null} />
		</Column>
	);
}

/**
 * Which columns the board shows, picked in a menu above it: each lane and
 * the untriaged, with how many todos it holds, or all at once. The button
 * says how many are hidden, once one is.
 */
export function ShownLanes({
	lanes,
	untriaged,
	hidden,
	onToggle,
	onHide,
}: {
	lanes: LaneState[];
	/** How many todos are in no lane. */
	untriaged: number;
	/** The lanes left out, null for the untriaged. */
	hidden: (number | null)[];
	onToggle: (lane: number | null) => void;
	/** Hides these columns and shows the rest. */
	onHide: (lanes: (number | null)[]) => void;
}): JSX.Element {
	const columns = [
		{ id: null, name: "Untriaged", count: untriaged },
		...lanes.map((lane) => ({
			id: lane.id,
			name: lane.name,
			count: lane.todos.length,
		})),
	];
	const left = columns.filter((column) => hidden.includes(column.id)).length;
	return (
		<div className="mb-2 flex">
			<DropdownMenu>
				<DropdownMenuTrigger render={<Button size="sm" variant="outline" />}>
					<Columns3Icon data-icon="inline-start" />
					Lanes
					{left > 0 && (
						<span className="text-muted-foreground text-xs">
							· {left} hidden
						</span>
					)}
					<ChevronDownIcon data-icon="inline-end" />
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start" className="w-64">
					<DropdownMenuGroup>
						<DropdownMenuLabel>Show on the board</DropdownMenuLabel>
						<DropdownMenuItem
							closeOnClick={false}
							onClick={() =>
								onHide(left > 0 ? [] : columns.map((column) => column.id))
							}
						>
							{left > 0 ? <EyeIcon /> : <EyeOffIcon />}
							{left > 0 ? "Show all" : "Hide all"}
						</DropdownMenuItem>
						<DropdownMenuSeparator />
						{columns.map((column) => (
							<DropdownMenuCheckboxItem
								key={column.id ?? "untriaged"}
								checked={!hidden.includes(column.id)}
								onCheckedChange={() => onToggle(column.id)}
							>
								<span className="min-w-0 flex-1 truncate">{column.name}</span>
								<span className="text-muted-foreground text-xs tabular-nums">
									{column.count}
								</span>
							</DropdownMenuCheckboxItem>
						))}
					</DropdownMenuGroup>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}

/**
 * One lane: an agent's queue, top first. The header says who is on it, or
 * offers the prompt that starts one.
 */
export function Lane({
	lane,
	lanes,
	staleness,
}: {
	lane: LaneState;
	/** Every lane, so this one can join another. */
	lanes: LaneState[];
	staleness: number;
}): JSX.Element {
	const { openTask } = useContext(Board);
	const [renaming, setRenaming] = useState(false);
	return (
		<Column lane={lane.id} label={lane.name}>
			<header className="flex flex-col gap-1 px-1 pt-1">
				<div className="flex items-center justify-between gap-2">
					{renaming ? (
						<LaneName lane={lane} onDone={() => setRenaming(false)} />
					) : (
						<h3 className="flex min-w-0 items-baseline font-medium text-sm">
							<button
								type="button"
								onClick={() => setRenaming(true)}
								title="Rename"
								className="-mx-1 min-w-0 cursor-text truncate rounded px-1 text-left outline-none hover:bg-background/70 focus-visible:ring-2 focus-visible:ring-ring"
							>
								{lane.name}
							</button>
							<span className="ml-1.5 font-normal text-muted-foreground text-xs tabular-nums">
								{lane.todos.length}
							</span>
						</h3>
					)}
					<LaneMenu
						lane={lane}
						lanes={lanes}
						onRename={() => setRenaming(true)}
					/>
				</div>
				{lane.agents.length > 0
					? lane.agents.map((agent) => {
							const on = lane.todos
								.filter((todo) => todo.takenBy === agent)
								.map((todo) => `#${todo.id}`)
								.join(", ");
							return (
								<button
									key={agent}
									type="button"
									onClick={() => openTask(agent)}
									className="inline-flex w-fit cursor-pointer items-center gap-1 rounded text-muted-foreground text-xs outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
								>
									<GitBranchIcon aria-hidden className="size-3" />
									{agent} on {on}
								</button>
							);
						})
					: lane.next !== null && <StartLane lane={lane} />}
			</header>
			<Cards
				todos={lane.todos}
				label={`${lane.name} todos`}
				staleness={staleness}
				steps
			/>
			<AddTodo lane={lane.id} />
		</Column>
	);
}

/**
 * Copies `[ARBOR LANE <n>]` while no agent is on the lane: pasted into an
 * agent's chat, it starts at the top and works down.
 */
function StartLane({ lane }: { lane: LaneState }): JSX.Element {
	return (
		<Button
			size="xs"
			variant="outline"
			className="w-fit bg-transparent"
			onClick={() => void copy(laneReference(lane.id))}
			title={`No agent is on it yet. Copies ${laneReference(lane.id)} to paste into an agent's chat`}
		>
			<CopyIcon data-icon="inline-start" />
			Start lane
		</Button>
	);
}

/** The lane's name as a field, saved on Enter or on leaving it. */
function LaneName({
	lane,
	onDone,
}: {
	lane: LaneState;
	onDone: () => void;
}): JSX.Element {
	const [name, setName] = useState(lane.name);
	const save = () => {
		if (name.trim() === "" || name.trim() === lane.name) {
			onDone();
			return;
		}
		void attempt(renameLane(lane.id, name), "Not renamed").then(onDone);
	};
	return (
		<input
			// biome-ignore lint/a11y/noAutofocus: it opens because the name was just clicked, to type a new one
			autoFocus
			aria-label="lane name"
			value={name}
			onChange={(event) => setName(event.target.value)}
			onFocus={(event) => event.target.select()}
			onBlur={save}
			onKeyDown={(event) => {
				if (event.key === "Enter") {
					save();
				} else if (event.key === "Escape") {
					onDone();
				}
			}}
			className="h-7 min-w-0 flex-1 rounded-md border bg-background px-2 font-semibold text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
		/>
	);
}

/** What can be done to a whole lane: start it, rename it, fold it into another, or remove it. */
function LaneMenu({
	lane,
	lanes,
	onRename,
}: {
	lane: LaneState;
	lanes: LaneState[];
	onRename: () => void;
}): JSX.Element {
	const others = lanes.filter((other) => other.id !== lane.id);
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						size="icon-xs"
						variant="ghost"
						aria-label={`${lane.name} actions`}
						{...still}
					/>
				}
			>
				<MoreHorizontalIcon />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-64">
				<DropdownMenuItem onClick={() => void copy(laneReference(lane.id))}>
					<CopyIcon />
					Copy {laneReference(lane.id)}
				</DropdownMenuItem>
				<DropdownMenuItem onClick={onRename}>
					<PencilIcon />
					Rename
				</DropdownMenuItem>
				{others.length > 0 && lane.todos.length > 0 && (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuGroup>
							<DropdownMenuLabel>
								Move its todos to the end of
							</DropdownMenuLabel>
							{others.map((other) => (
								<DropdownMenuItem
									key={other.id}
									onClick={() =>
										void attempt(joinLanes(lane.id, other.id), "Not moved")
									}
								>
									<MergeIcon />
									{other.name}
								</DropdownMenuItem>
							))}
						</DropdownMenuGroup>
					</>
				)}
				<DropdownMenuSeparator />
				<DropdownMenuItem
					onClick={() => void attempt(dropLane(lane.id), "Lane not removed")}
				>
					<Undo2Icon />
					{lane.todos.length === 0
						? "Remove lane"
						: "Remove lane, untriage its todos"}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/**
 * "Add a todo" at the foot of a column, opening into a box for its subject,
 * the way Trello adds a card: Enter adds it at the bottom of the column and
 * leaves the box open for the next, Escape puts it away. `@` names a file
 * in the repo, and a pasted or attached file goes with it.
 */
function AddTodo({ lane }: { lane: number | null }): JSX.Element {
	const [open, setOpen] = useState(false);
	if (!open) {
		return (
			<button
				type="button"
				onClick={() => setOpen(true)}
				className="flex w-full cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-muted-foreground text-sm outline-none hover:bg-background/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
			>
				<PlusIcon aria-hidden className="size-4" />
				Add a todo
			</button>
		);
	}
	return <Composer lane={lane} onClose={() => setOpen(false)} />;
}

function Composer({
	lane,
	onClose,
}: {
	lane: number | null;
	onClose: () => void;
}): JSX.Element {
	const [draft] = useState(() => new TodoDraft());
	const { ready } = useReactive(draft, (draft) => ({ ready: draft.ready }), [
		"changed",
	]);
	const subject = useMentions<HTMLTextAreaElement>(draft.subject);

	const submit = (event?: FormEvent) => {
		event?.preventDefault();
		void attempt(draft.add(lane), "Not added").then(() =>
			subject.ref.current?.focus(),
		);
	};
	const keys = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		subject.onKeyDown(event);
		if (event.defaultPrevented) {
			return; // the file list took it
		}
		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();
			submit();
		} else if (event.key === "Escape") {
			onClose();
		}
	};
	return (
		<form onSubmit={submit} className="flex flex-col gap-2">
			<MentionAnchor mentions={subject}>
				<textarea
					ref={subject.ref}
					// biome-ignore lint/a11y/noAutofocus: it opens because "Add a todo" was just pressed, to type one
					autoFocus
					aria-label="new todo"
					placeholder="Enter a title for this todo, @ for a file"
					rows={3}
					value={subject.value}
					onChange={subject.onChange}
					onSelect={subject.onSelect}
					onClick={subject.onClick}
					onKeyDown={keys}
					onPaste={(event) => draft.files.paste(event)}
					className="w-full resize-none rounded-lg border bg-card px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
				/>
			</MentionAnchor>
			<FileList files={draft.files} />
			<div className="flex items-center gap-1">
				<Button type="submit" size="sm" disabled={!ready}>
					Add todo
				</Button>
				<Button
					type="button"
					size="icon-sm"
					variant="ghost"
					aria-label="stop adding"
					onClick={onClose}
				>
					<XIcon />
				</Button>
				<span className="ml-auto">
					<AttachButton files={draft.files} />
				</span>
			</div>
		</form>
	);
}

/**
 * The last column, Trello's "Add another list": a name starts an empty lane.
 * While a card is in hand it is where to drop it to start a lane of its
 * own, and a card dropped there waits in it for the lane's name.
 */
export function AddLane({
	dragging,
	naming,
	onName,
	onUnname,
}: {
	dragging: boolean;
	/** The card dropped here, waiting for its lane's name. */
	naming?: TodoState;
	/** Starts the lane `naming` waits for. */
	onName: (name: string) => Promise<void>;
	/** Puts `naming` back where it was. */
	onUnname: () => void;
}): JSX.Element {
	const [open, setOpen] = useState(false);
	const [name, setName] = useState("");
	const { setNodeRef, isOver } = useDroppable({ id: columnId("new") });
	const close = () => {
		setOpen(false);
		setName("");
		if (naming) {
			onUnname();
		}
	};
	const save = (event: FormEvent) => {
		event.preventDefault();
		if (name.trim() === "") {
			return;
		}
		const write = naming ? onName(name) : addLane(name);
		void attempt(write, "Lane not added").then((added) => {
			if (added) {
				setName("");
				if (naming) {
					setOpen(false);
				}
			}
		});
	};
	return (
		<section
			ref={setNodeRef}
			aria-label="new lane"
			className={cn(
				"w-72 shrink-0 snap-start rounded-xl transition-colors",
				dragging
					? "border-2 border-dashed p-3"
					: (open || naming) && "bg-muted/70 p-2 dark:bg-muted/30",
				isOver && "bg-primary/10 ring-2 ring-primary/40",
			)}
		>
			{dragging ? (
				<p className="flex items-center gap-1.5 text-muted-foreground text-sm">
					<PlusIcon aria-hidden className="size-4" />
					Drop here to start a lane
				</p>
			) : open || naming ? (
				<form onSubmit={save} className="flex flex-col gap-2">
					{naming && (
						<p className="truncate px-1 text-muted-foreground text-xs">
							A lane for #{naming.id} {naming.subject}
						</p>
					)}
					<input
						// biome-ignore lint/a11y/noAutofocus: it opens because "Add another lane" was just pressed, or a card dropped here, to type its name
						autoFocus
						aria-label="new lane name"
						placeholder="Enter lane name"
						value={name}
						onChange={(event) => setName(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Escape") {
								close();
							}
						}}
						className="h-8 rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
					<div className="flex items-center gap-1">
						<Button type="submit" size="sm" disabled={name.trim() === ""}>
							Add lane
						</Button>
						<Button
							type="button"
							size="icon-sm"
							variant="ghost"
							aria-label="stop adding a lane"
							onClick={close}
						>
							<XIcon />
						</Button>
					</div>
				</form>
			) : (
				<button
					type="button"
					onClick={() => setOpen(true)}
					className="flex w-full cursor-pointer items-center gap-1.5 rounded-xl px-3 py-2.5 text-left text-muted-foreground text-sm outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
				>
					<PlusIcon aria-hidden className="size-4" />
					Add another lane
				</button>
			)}
		</section>
	);
}
