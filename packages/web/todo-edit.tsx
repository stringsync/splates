import type { TaskRecord } from "@splates/server/board";
import { BACKLOG_LANE } from "@splates/server/board/browser";
import { holdsBack } from "@splates/server/queue/browser";
import { useReactive } from "core/react";
import { Trash2Icon } from "lucide-react";
import { type JSX, useContext, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#web/components/ui/dialog.tsx";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupTextarea,
} from "#web/components/ui/input-group.tsx";
import { cn } from "#web/lib/utils.ts";
import { assignTodo } from "./api";
import { BlockedFixButton, blockedFix } from "./blocked-fix";
import { Board as BoardContext } from "./board";
import { assigned } from "./board-expectations";
import { CopyLink } from "./card";
import { AttachPlus } from "./card-box";
import { CardSection } from "./card-section";
import { AssigneeMenu, Dispatching, OnIt } from "./dispatching";
import { todoEdit } from "./drafts";
import { useExpectSnapshot } from "./expecting";
import { Dropped, FileList } from "./files";
import { Links, Property } from "./links";
import { ElsewhereMention, Markdown } from "./markdown";
import { MentionAnchor, useMentions } from "./mentions";
import { paragraphs } from "./merged-body";
import { Refusal, useRefusal } from "./refusal";
import { StartMenu } from "./start-menu";
import { TaskIcon } from "./task-icon";
import { planParts } from "./task-plan-parts";
import { TodoEditor } from "./todo-editor";
import { QueueToggle, StageChip, shownStage, stageLabel } from "./todo-queue";

/** The dialog for one todo: reword it, edit its detail, agent and links, then save, start or drop it. */
export function Edit({
	todo,
	onDone,
}: {
	todo: TaskRecord;
	onDone: () => void;
}): JSX.Element {
	const board = useContext(BoardContext);
	const [editor] = useState(
		() =>
			new TodoEditor(
				todo,
				board.drafts,
				todoEdit(new URLSearchParams(location.search).get("project"), todo.id),
			),
	);
	const { busy, confirming, changed, restored, dropped } = useReactive(
		editor,
		(editor) => ({
			busy: editor.busy,
			confirming: editor.confirming,
			changed: editor.changed,
			restored: editor.restored,
			dropped: editor.dropped,
		}),
		["changed"],
	);
	// Its step in its lane says more than its place in the whole list. One in
	// Backlog is in no sequence, so it says only that.
	const steps = board.todos.filter((other) => other.lane === todo.lane);
	const lane = board.lanes.find((record) => record.id === todo.lane);
	const place =
		lane === undefined
			? "Backlog"
			: lane.id === BACKLOG_LANE
				? "In Backlog"
				: `Step ${steps.findIndex((other) => other.id === todo.id) + 1} of ${steps.length} in ${lane.name}`;
	const mentions = useMentions<HTMLTextAreaElement>(editor.subject);

	const { refusal, refuse } = useRefusal();
	const expect = useExpectSnapshot();
	// Shown on the board at once, so the dialog goes at the click; refused,
	// the card says why, and the todo opens again on what was typed.
	const settle = (writing: Promise<void> | null, failed: string): void => {
		if (writing === null) {
			return;
		}
		onDone();
		writing.catch((error: unknown) => board.refuseTodo(todo.id, failed, error));
	};
	const stage = shownStage(todo, board.todos, board.tasks);
	const waiting =
		stage === "queued" || (stage === "blocked" && todo.takenBy === null)
			? holdsBack(todo, board.todos)
			: null;
	const hasBlockers =
		waiting !== null &&
		(waiting.open.length > 0 || waiting.elsewhere.length > 0);
	// Those that wait on it, which removing it holds for the person.
	const heldBack = board.todos.filter((other) =>
		other.blockedBy.includes(todo.id),
	);
	return (
		<>
			<DialogHeader className="gap-1.5">
				<DialogTitle className="flex items-start gap-2 pr-8">
					<TaskIcon aria-hidden className="mt-1 size-4 shrink-0" />
					<span className="sr-only">Task {todo.id}:</span>
					<span className="min-w-0 flex-1">
						<MentionAnchor mentions={mentions}>
							{/* Grows to show the whole subject, which stays one line: Enter
							    picks a mention or does nothing. */}
							<textarea
								ref={mentions.ref}
								aria-label="subject"
								rows={1}
								value={mentions.value}
								onChange={(event) => {
									// A pasted line break would split the subject; it reads as a space.
									event.target.value = event.target.value.replace(
										/\r?\n/g,
										" ",
									);
									mentions.onChange(event);
								}}
								onSelect={mentions.onSelect}
								onClick={mentions.onClick}
								onKeyDown={(event) => {
									if (!mentions.onKeyDown(event) && event.key === "Enter") {
										event.preventDefault();
									}
								}}
								onPaste={(event) => editor.files.paste(event)}
								className="-mx-1.5 field-sizing-content block w-[calc(100%+0.75rem)] resize-none rounded-md bg-transparent px-1.5 py-0.5 font-[inherit] leading-snug wrap-anywhere outline-none transition-colors hover:bg-muted/50 focus-visible:bg-transparent focus-visible:ring-2 focus-visible:ring-ring"
							/>
						</MentionAnchor>
					</span>
				</DialogTitle>
				<div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
					<StageChip stage={stage}>
						{stageLabel(todo, board.todos, board.tasks)}
					</StageChip>
					<span className="flex min-w-0 items-center gap-1 text-muted-foreground text-xs">
						<CopyLink id={todo.id} />
						<span aria-hidden>·</span>
						<DialogDescription className="min-w-0 text-muted-foreground text-xs">
							{todo.takenBy ? `Taken by ${todo.takenBy}` : place}
						</DialogDescription>
					</span>
				</div>
			</DialogHeader>
			<div className="-mx-4 flex min-h-0 flex-col gap-3 overflow-y-auto px-4 pb-1 [&>*]:shrink-0">
				{hasBlockers && (
					<BlockedPart todo={todo} waiting={waiting} onDone={onDone} />
				)}
				{restored && (
					<p className="flex items-center gap-2 text-muted-foreground text-xs">
						Unsaved changes kept from before
						<Button
							size="xs"
							variant="ghost"
							onClick={() => editor.discard()}
							className="pointer-coarse:h-10 pointer-coarse:px-3"
						>
							Discard
						</Button>
					</p>
				)}
				{/* An agent at work, or the conversation held for it once queued. */}
				{todo.takenBy !== null ? (
					<OnIt task={todo.takenBy} variant="rows" className="-mx-2" />
				) : (
					todo.stage === "queued" && (
						<OnIt
							task={null}
							queued={todo.id}
							variant="rows"
							className="-mx-2"
						/>
					)
				)}
				<Detail editor={editor} />
				<FileList files={editor.files} />
				<Dropped names={dropped} />
				<div className="border-t pt-3 [&_[data-slot=select-trigger]]:max-w-full [&_[data-slot=select-value]]:truncate">
					<Links todo={todo}>
						{todo.takenBy === null && (
							<Property title="Agent">
								<AssigneeMenu
									assignee={todo.assignee ?? null}
									onPick={(pick) =>
										void expect(
											assigned(todo.id, pick),
											assignTodo(todo.id, pick),
										).catch((error: unknown) => refuse("Not assigned", error))
									}
									className="-ml-2"
								/>
							</Property>
						)}
					</Links>
					<Refusal refusal={refusal} />
					<Refusal refusal={board.refusedTodos.get(todo.id)} />
				</div>
			</div>
			{confirming && heldBack.length > 0 && (
				<p className="text-muted-foreground text-sm">
					Removing this holds{" "}
					{heldBack.map((other) => `#${other.id} ${other.subject}`).join(", ")}{" "}
					as Blocked, since {heldBack.length === 1 ? "it waits" : "they wait"}{" "}
					on this task. Let go of the link on{" "}
					{heldBack.length === 1 ? "its" : "each"} card to keep{" "}
					{heldBack.length === 1 ? "it" : "them"} queued.
				</p>
			)}
			<DialogFooter className="flex-row justify-between sm:justify-between">
				<Button
					variant={confirming ? "destructive" : "ghost"}
					disabled={busy}
					className="pointer-coarse:h-10 pointer-coarse:px-3"
					onClick={() => settle(editor.remove(expect), "Not removed")}
				>
					<Trash2Icon data-icon="inline-start" />
					{confirming ? "Remove for good" : "Remove"}
				</Button>
				<div className="flex gap-2">
					{hasBlockers && <QueueToggle todo={todo} dialog />}
					{todo.takenBy === null && !hasBlockers && (
						<StartMenu
							assignment={{ kind: "todo", id: todo.id }}
							assignee={todo.assignee ?? null}
							size="sm"
							onStart={onDone}
						/>
					)}
					<Button
						disabled={!changed || busy}
						onClick={() => settle(editor.save(expect), "Not saved")}
						className="pointer-coarse:h-10 pointer-coarse:px-4"
					>
						Save
					</Button>
				</div>
			</DialogFooter>
		</>
	);
}

/**
 * A todo's detail, read as it renders, the way a Trello card opens; a click
 * on it, but on a link in it, writes its markdown, until focus leaves.
 */
function Detail({ editor }: { editor: TodoEditor }): JSX.Element {
	const detail = useMentions<HTMLTextAreaElement>(editor.detail);
	const [writing, setWriting] = useState(false);
	if (writing) {
		return (
			<MentionAnchor mentions={detail}>
				<InputGroup
					onBlur={(event) => {
						if (!event.currentTarget.contains(event.relatedTarget)) {
							setWriting(false);
						}
					}}
				>
					<InputGroupTextarea
						ref={detail.ref}
						autoFocus
						aria-label="detail"
						placeholder="More to say in markdown, if any"
						value={detail.value}
						onChange={detail.onChange}
						onSelect={detail.onSelect}
						onClick={detail.onClick}
						onKeyDown={detail.onKeyDown}
						onPaste={(event) => editor.files.paste(event)}
						className="min-h-32"
					/>
					<InputGroupAddon align="block-end">
						<AttachPlus files={editor.files} />
					</InputGroupAddon>
				</InputGroup>
			</MentionAnchor>
		);
	}
	if (detail.value.trim() === "") {
		return (
			<button
				type="button"
				onClick={() => setWriting(true)}
				className="flex min-h-40 items-start rounded-md border border-dashed px-3 py-2 text-left text-muted-foreground text-sm transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				Add more detail
			</button>
		);
	}
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: a click anywhere on the words writes them, but a link in them still opens; its own button is what a keyboard reaches
		// biome-ignore lint/a11y/useKeyWithClickEvents: as above
		<div
			className="relative min-h-40 cursor-text rounded-md border px-3 py-2 text-sm transition-colors hover:bg-muted/30"
			onClick={(event) => {
				if (!(event.target as HTMLElement).closest("a, button")) {
					setWriting(true);
				}
			}}
		>
			<DetailText text={detail.value} />
			<Button
				size="xs"
				variant="ghost"
				className="sr-only absolute top-1 right-1 focus-visible:not-sr-only"
				onClick={() => setWriting(true)}
			>
				Edit
			</Button>
		</div>
	);
}

/**
 * An idle task's detail: its goal, the first paragraph of `## After` (or of
 * a plain detail), led as the goal, then the rest as details. A detail
 * written as `## Before` and `## After` folds Before into the details,
 * labelled, so an old task loses nothing.
 */
function DetailText({ text }: { text: string }): JSX.Element {
	const parts = planParts(text);
	const sectioned = parts.before !== "" || parts.goal !== "";
	const source = sectioned ? parts.goal : text;
	const [first = "", ...others] = paragraphs(source);
	const leads = !/^\s*(#|[-*+>|]|\d+[.)]|```|~~~)/.test(first);
	const goal = leads ? first : "";
	const rest = leads ? others.join("\n\n") : source.trim();
	const details = [
		rest,
		...(sectioned
			? [
					parts.before === "" ? "" : `### Before\n\n${parts.before}`,
					parts.steps,
					parts.notes,
				]
			: []),
	].filter((each) => each !== "");
	return (
		<div className="flex min-w-0 flex-col">
			{goal !== "" && (
				<div
					className={cn(
						"font-medium text-base text-foreground",
						details.length > 0 && "pb-5",
					)}
				>
					<Markdown text={goal} />
				</div>
			)}
			{details.length > 0 && (
				<CardSection
					label="Details"
					beside
					title="Details"
					ruled={goal !== ""}
					className={goal === "" ? "py-0" : undefined}
				>
					<Markdown text={details.join("\n\n")} />
				</CardSection>
			)}
		</div>
	);
}

/** The open dependencies and the actions that can move a queued task forward. */
function BlockedPart({
	todo,
	waiting,
	onDone,
}: {
	todo: TaskRecord;
	waiting: ReturnType<typeof holdsBack>;
	onDone: () => void;
}): JSX.Element {
	const { todos, elsewhere } = useContext(BoardContext);
	const fix = blockedFix(todo, todos);
	const rows =
		fix?.kind === "queue"
			? [
					...fix.chain,
					...waiting.open.filter(
						(blocker) => !fix.chain.some((each) => each.id === blocker.id),
					),
				]
			: waiting.open;
	return (
		<section
			aria-label="what blocks it"
			className="flex flex-col gap-1.5 border-t pt-2 text-sm"
		>
			<p className="font-medium text-muted-foreground text-xs">Waiting on</p>
			<ul className="divide-y">
				{rows.map((blocker) => (
					<BlockerLine key={blocker.id} blocker={blocker} onDone={onDone} />
				))}
				{waiting.elsewhere.map((blocker) => {
					const current = elsewhere?.blockers[todo.id]?.find(
						(each) =>
							each.project === blocker.project && each.id === blocker.id,
					);
					const slug =
						current?.slug ??
						blocker.project.split("/").filter(Boolean).at(-1) ??
						blocker.project;
					return (
						<li key={`${blocker.project}#${blocker.id}`} className="py-1.5">
							<ElsewhereMention project={slug} id={blocker.id} />{" "}
							{current?.subject ?? blocker.subject}
							{current && (
								<p className="text-muted-foreground text-xs capitalize">
									{current.status}
								</p>
							)}
						</li>
					);
				})}
			</ul>
			<div className="empty:hidden">
				<BlockedFixButton todo={todo} />
			</div>
		</section>
	);
}

function BlockerLine({
	blocker,
	onDone,
}: {
	blocker: TaskRecord;
	onDone: () => void;
}): JSX.Element {
	const board = useContext(BoardContext);
	const dispatching = useContext(Dispatching);
	const activity =
		blocker.takenBy === null
			? undefined
			: dispatching?.dispatch
					.on(blocker.takenBy)
					.find((each) => each.conversation !== null);
	const conversation = activity?.conversation;
	let status = stageLabel(blocker, board.todos, board.tasks);
	if (blocker.closesOn !== undefined) {
		status = "Waiting for a signal";
	} else if (
		conversation?.status === "stopped" ||
		conversation?.status === "failed"
	) {
		status = "Conversation stopped";
	} else if (activity?.need.kind === "waiting") {
		status =
			activity.need.why === "review" ? "Ready for review" : "Needs attention";
	}

	return (
		<li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 py-1.5">
			<div className="min-w-0">
				<button
					type="button"
					className="cursor-pointer text-left font-medium wrap-anywhere hover:underline"
					onClick={() => board.open(blocker.id)}
				>
					#{blocker.id} · {blocker.subject}
				</button>
				<p className="text-muted-foreground text-xs">{status}</p>
			</div>
			{conversation && dispatching && (
				<Button
					size="sm"
					variant="link"
					className="h-auto px-0 text-sm pointer-coarse:min-h-10"
					aria-label={`Open conversation for #${blocker.id}`}
					onClick={() => {
						onDone();
						dispatching.open(conversation.id);
					}}
				>
					Open conversation
				</Button>
			)}
		</li>
	);
}
