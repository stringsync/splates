import { type UniqueIdentifier, useDroppable } from "@dnd-kit/core";
import {
	SortableContext,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useReactive } from "@webappwiz/react";
import {
	ArrowLeftIcon,
	ArrowRightIcon,
	CheckIcon,
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
	UserIcon,
	XIcon,
} from "lucide-react";
import {
	type CSSProperties,
	type FormEvent,
	type JSX,
	type KeyboardEvent,
	type MouseEventHandler,
	type ReactNode,
	type Ref,
	type TouchEventHandler,
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
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "#dev/components/ui/dropdown-menu.tsx";
import { cn } from "#dev/lib/utils.ts";
import type { LaneState } from "../lanes";
import { laneReference } from "../prompts";
import type { TodoState } from "../todo";
import { addLane, assignLane, dropLane, joinLanes, renameLane } from "./api";
import { Board, still } from "./board";
import { Card, copiedLabel, Sortable, useCopy } from "./card";
import { AssigneeItems, Dispatching, OnIt, StartMenu } from "./dispatching";
import { type Drafts, todoDraft } from "./drafts";
import { AttachButton, Dropped, FileList } from "./files";
import { MentionAnchor, useMentions } from "./mentions";
import { Refusal, useRefusal } from "./refusal";
import { TodoDraft } from "./todo-draft";

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

/** The lane a `columnId` names when it is a lane's own, not the untriaged or new one. */
export function laneOf(id: string | number): number | undefined {
	const lane = columnOf(id);
	return typeof lane === "number" ? lane : undefined;
}

/**
 * A column a card can be dropped on, lit while one is over it: the cards in
 * it are their own targets, and the rest of it means the bottom. Every
 * column is a Trello list: a header, its cards, and a way to add one.
 */
function Column({
	label,
	drop,
	lit,
	style,
	className,
	children,
}: {
	label: string;
	/** Where the column takes a dropped card. */
	drop: Ref<HTMLElement>;
	/** A card is over it. */
	lit: boolean;
	style?: CSSProperties;
	className?: string;
	children: ReactNode;
}): JSX.Element {
	return (
		<section
			ref={drop}
			aria-label={label}
			style={style}
			className={cn(
				"flex max-h-[calc(100dvh-6rem)] w-72 shrink-0 snap-start flex-col gap-1.5 rounded-xl bg-muted/40 p-2 transition-colors dark:bg-muted/20",
				lit && "bg-primary/5 ring-1 ring-primary/30",
				className,
			)}
		>
			{children}
		</section>
	);
}

/** The lane of the card `id` names, null for none, undefined for no card. */
function laneOfCard(
	todos: TodoState[],
	id: UniqueIdentifier | undefined,
): number | null | undefined {
	return todos.find((todo) => todo.id === id)?.lane;
}

/** A column's cards, top first, each a drag handle and a drop target. */
function Cards({
	todos,
	label,
	staleness,
	steps,
	coming,
}: {
	todos: TodoState[];
	label: string;
	staleness: number;
	/** Number the cards, as a lane's steps are. */
	steps: boolean;
	/**
	 * A card from another column is over this one but none of its cards, so
	 * it lands at the bottom: a line there says so, as one above a card does.
	 */
	coming: boolean;
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
				{coming && (
					<li
						aria-hidden
						className="mx-1 h-1 shrink-0 rounded-full bg-primary"
					/>
				)}
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
	const { setNodeRef, isOver, active } = useDroppable({
		id: columnId(null),
	});
	return (
		<Column label="Untriaged" drop={setNodeRef} lit={isOver}>
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
				coming={isOver && laneOfCard(board.todos, active?.id) !== null}
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
		<DropdownMenu>
			<DropdownMenuTrigger render={<Button size="sm" variant="outline" />}>
				<Columns3Icon data-icon="inline-start" />
				Lanes
				{left > 0 && (
					<span className="text-muted-foreground text-xs">· {left} hidden</span>
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
	);
}

/**
 * One lane: an agent's queue, top first. The header says who is on it, or
 * offers the prompt that starts one, and moves the lane: dragged by it, the
 * lane takes the place of the one it is let go on, as a Trello list does.
 */
export function Lane({
	lane,
	lanes,
	staleness,
}: {
	lane: LaneState;
	/** Every lane, so this one can join another or move past it. */
	lanes: LaneState[];
	staleness: number;
}): JSX.Element {
	const { openTask, refusedLanes, todos } = useContext(Board);
	const [renaming, setRenaming] = useState(false);
	const {
		listeners,
		setNodeRef,
		setActivatorNodeRef,
		transform,
		transition,
		isDragging,
		isOver,
		active,
	} = useSortable({ id: columnId(lane.id) });
	// Lit for a card over it, not for a lane passing by.
	const lit = isOver && active !== null && laneOf(active.id) === undefined;
	return (
		<Column
			label={lane.name}
			drop={setNodeRef}
			lit={lit}
			style={{ transform: CSS.Translate.toString(transform), transition }}
			// The slot it leaves while it is in hand, where it will land.
			className={cn(isDragging && "bg-muted ring-1 ring-border *:invisible")}
		>
			{/* A mouse drags the lane from its header once it moves a few pixels
			    and a finger after a short press, so a tap still renames it; a
			    keyboard moves it from its menu. */}
			{/* biome-ignore lint/a11y/noStaticElementInteractions: a pointer drags the lane by its header; a keyboard has Move left and right in its menu */}
			<header
				ref={setActivatorNodeRef}
				onMouseDown={listeners?.onMouseDown as MouseEventHandler}
				onTouchStart={listeners?.onTouchStart as TouchEventHandler}
				className="flex cursor-grab touch-manipulation flex-col gap-1 px-1 pt-1 active:cursor-grabbing"
			>
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
								<span key={agent} className="flex min-w-0 items-center gap-1.5">
									<button
										type="button"
										onClick={() => openTask(agent)}
										{...still}
										className="inline-flex min-w-0 cursor-pointer items-center gap-1 rounded text-muted-foreground text-xs outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
									>
										<GitBranchIcon aria-hidden className="size-3" />
										<span className="truncate">
											{agent} on {on}
										</span>
									</button>
									<OnIt task={agent} />
								</span>
							);
						})
					: lane.next !== null && <StartLane lane={lane} />}
				<Refusal refusal={refusedLanes.get(lane.id)} />
			</header>
			<Cards
				todos={lane.todos}
				label={`${lane.name} todos`}
				staleness={staleness}
				steps
				coming={lit && laneOfCard(todos, active?.id) !== lane.id}
			/>
			<AddTodo lane={lane.id} />
		</Column>
	);
}

/**
 * While no agent is on the lane, puts one on it with `[ARBOR LANE <n>]`,
 * which starts at the top and works down: in a conversation, or, while the
 * page holds none, copied to paste into an agent's chat.
 */
function StartLane({ lane }: { lane: LaneState }): JSX.Element {
	const { copied, copy } = useCopy();
	if (useContext(Dispatching) !== null) {
		return (
			<StartMenu
				assignment={{ kind: "lane", id: lane.id }}
				assignee={lane.assignee}
				label="Start lane"
			/>
		);
	}
	return (
		<Button
			size="xs"
			variant="outline"
			className="w-fit bg-transparent"
			onClick={() => copy(laneReference(lane.id))}
			title={
				copied.state === "failed"
					? copied.error
					: `No agent is on it yet. Copies ${laneReference(lane.id)} to paste into an agent's chat`
			}
		>
			{copied.state === "copied" ? (
				<CheckIcon data-icon="inline-start" />
			) : (
				<CopyIcon data-icon="inline-start" />
			)}
			<span aria-live="polite">{copiedLabel(copied, "Start lane")}</span>
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
	const { refuseLane } = useContext(Board);
	const [name, setName] = useState(lane.name);
	const save = () => {
		if (name.trim() === "" || name.trim() === lane.name) {
			onDone();
			return;
		}
		void renameLane(lane.id, name)
			.catch((error: unknown) => refuseLane(lane.id, "Not renamed", error))
			.then(onDone);
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

/**
 * A lane in hand, lifted off the board and tilted the way Trello lifts a
 * list: its name and its cards, to see what is moving.
 */
export function LiftedLane({
	lane,
	staleness,
}: {
	lane: LaneState;
	staleness: number;
}): JSX.Element {
	return (
		<section
			aria-hidden
			className="flex max-h-[calc(100dvh-6rem)] w-72 rotate-2 cursor-grabbing flex-col gap-1.5 overflow-hidden rounded-xl bg-muted p-2 shadow-lg"
		>
			<h3 className="flex items-baseline gap-1.5 px-1 pt-1 font-medium text-sm">
				{lane.name}
				<span className="font-normal text-muted-foreground text-xs tabular-nums">
					{lane.todos.length}
				</span>
			</h3>
			<ol className="flex flex-col gap-1.5">
				{lane.todos.map((todo, i) => (
					<li key={todo.id}>
						<Card todo={todo} staleness={staleness} step={i + 1} />
					</li>
				))}
			</ol>
		</section>
	);
}

/** What can be done to a whole lane: start it, rename it, move it, fold it into another, or remove it. */
function LaneMenu({
	lane,
	lanes,
	onRename,
}: {
	lane: LaneState;
	lanes: LaneState[];
	onRename: () => void;
}): JSX.Element {
	const { moveLane, refuseLane } = useContext(Board);
	const dispatching = useContext(Dispatching);
	const { copied, copy } = useCopy();
	const others = lanes.filter((other) => other.id !== lane.id);
	const at = lanes.findIndex((other) => other.id === lane.id);
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
				<DropdownMenuItem
					closeOnClick={false}
					title={copied.state === "failed" ? copied.error : undefined}
					onClick={() => copy(laneReference(lane.id))}
				>
					{copied.state === "copied" ? <CheckIcon /> : <CopyIcon />}
					<span aria-live="polite">
						{copiedLabel(copied, `Copy ${laneReference(lane.id)}`)}
					</span>
				</DropdownMenuItem>
				<DropdownMenuItem onClick={onRename}>
					<PencilIcon />
					Rename
				</DropdownMenuItem>
				{dispatching !== null && (
					<DropdownMenuSub>
						<DropdownMenuSubTrigger>
							<UserIcon />
							<span className="flex-1">Assign to</span>
							<span className="truncate text-muted-foreground text-xs">
								{lane.assignee === null
									? "any agent"
									: dispatching.dispatch.pickName(lane.assignee)}
							</span>
						</DropdownMenuSubTrigger>
						<DropdownMenuSubContent className="w-52">
							<AssigneeItems
								assignee={lane.assignee}
								onPick={(pick) =>
									void assignLane(lane.id, pick).catch((error: unknown) =>
										refuseLane(lane.id, "Not assigned", error),
									)
								}
							/>
						</DropdownMenuSubContent>
					</DropdownMenuSub>
				)}
				{others.length > 0 && (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuItem
							disabled={at === 0}
							onClick={() => moveLane(lane.id, at)}
						>
							<ArrowLeftIcon />
							Move left
						</DropdownMenuItem>
						<DropdownMenuItem
							disabled={at === lanes.length - 1}
							onClick={() => moveLane(lane.id, at + 2)}
						>
							<ArrowRightIcon />
							Move right
						</DropdownMenuItem>
					</>
				)}
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
										void joinLanes(lane.id, other.id).catch((error: unknown) =>
											refuseLane(lane.id, "Not moved", error),
										)
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
					onClick={() =>
						void dropLane(lane.id).catch((error: unknown) =>
							refuseLane(lane.id, "Lane not removed", error),
						)
					}
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
	const { drafts } = useContext(Board);
	const key = todoDraft(
		new URLSearchParams(location.search).get("project"),
		lane,
	);
	// Open on a draft kept from before, so coming back shows what was typed.
	const [open, setOpen] = useState(() => drafts.read(key) !== "");
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
	return (
		<Composer
			lane={lane}
			draft={key}
			drafts={drafts}
			onClose={() => setOpen(false)}
		/>
	);
}

function Composer({
	lane,
	draft: key,
	drafts,
	onClose,
}: {
	lane: number | null;
	/** Where in `drafts` what is typed is kept. */
	draft: string;
	drafts: Drafts;
	onClose: () => void;
}): JSX.Element {
	const [draft] = useState(() => new TodoDraft(drafts, key));
	const { ready, dropped } = useReactive(
		draft,
		(draft) => ({ ready: draft.ready, dropped: draft.dropped }),
		["changed"],
	);
	const subject = useMentions<HTMLTextAreaElement>(draft.subject);
	const { refusal, attempt } = useRefusal();

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
			<Dropped names={dropped} />
			<Refusal refusal={refusal} />
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
	const { refusal, attempt } = useRefusal();
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
					<Refusal refusal={refusal} />
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
