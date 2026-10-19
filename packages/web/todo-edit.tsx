import { age } from "@stringsync/splates-server/age";
import type { TaskRecord } from "@stringsync/splates-server/board";
import { queueOrder } from "@stringsync/splates-server/queue/browser";
import { useReactive } from "@webappwiz/react";
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
import { Board as BoardContext } from "./board";
import { assigned } from "./board-expectations";
import { CopyLink } from "./card";
import { AttachPlus } from "./card-box";
import { AssigneeMenu, OnIt } from "./dispatching";
import { todoEdit } from "./drafts";
import { useExpectSnapshot } from "./expecting";
import { Dropped, FileList } from "./files";
import { Links, Property } from "./links";
import { Markdown } from "./markdown";
import { MentionAnchor, useMentions } from "./mentions";
import { Refusal, useRefusal } from "./refusal";
import { StartMenu } from "./start-menu";
import { TaskIcon } from "./task-icon";
import {
	Section,
	SectionTab,
	SectionTabs,
	TONES,
	type Tone,
} from "./task-sections";
import { TodoEditor } from "./todo-editor";
import { stageLabel, stageOf } from "./todo-queue";

/**
 * One todo opened, in the task dialog's shape: its subject to reword as the
 * title, where it stands and sits on the board under it, its detail and files
 * on Overview, its agent and links on Details, and in the footer a way to
 * drop it, start it, or save what changed.
 */
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
	const [tab, setTab] = useState("overview");
	// Its step in its lane says more than its place in the whole list. An
	// untriaged todo is in no sequence, so it says only that.
	const steps = board.todos.filter((other) => other.lane === todo.lane);
	const lane = board.lanes.find((record) => record.id === todo.lane);
	const place =
		lane === undefined
			? "Untriaged"
			: `Step ${steps.findIndex((other) => other.id === todo.id) + 1} of ${steps.length} in ${lane.name}`;
	const mentions = useMentions<HTMLInputElement>(editor.subject);

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
	const stage = stageOf(todo);
	return (
		<>
			<DialogHeader className="gap-1.5">
				<DialogTitle className="flex items-center gap-2 pr-8">
					<TaskIcon aria-hidden className="size-4 shrink-0" />
					<span className="sr-only">Task {todo.id}:</span>
					<span className="min-w-0 flex-1">
						<MentionAnchor mentions={mentions}>
							<input
								ref={mentions.ref}
								aria-label="subject"
								value={mentions.value}
								onChange={mentions.onChange}
								onSelect={mentions.onSelect}
								onClick={mentions.onClick}
								onKeyDown={mentions.onKeyDown}
								onPaste={(event) => editor.files.paste(event)}
								className="-mx-1.5 w-[calc(100%+0.75rem)] rounded-md bg-transparent px-1.5 py-0.5 font-[inherit] outline-none transition-colors hover:bg-muted/50 focus-visible:bg-transparent focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:h-10"
							/>
						</MentionAnchor>
					</span>
				</DialogTitle>
				<div className="flex min-w-0 items-baseline gap-2">
					<span
						className={cn(
							"shrink-0 rounded-md px-1.5 py-px font-medium text-xs",
							TONES[STAGE_TONES[stage]],
						)}
					>
						{stageLabel(
							todo,
							todo.stage === "queued" ? queueOrder(board.todos) : [],
						)}
					</span>
					<DialogDescription className="min-w-0 text-foreground text-sm">
						{todo.takenBy ? `Taken by ${todo.takenBy}` : place}
					</DialogDescription>
				</div>
				<p className="flex min-w-0 flex-wrap items-center gap-x-1 text-muted-foreground text-xs tabular-nums">
					<CopyLink id={todo.id} />
					<span>
						{" · "}
						added {age(todo.createdAt)} ago
						{todo.files.length > 0 &&
							` · ${todo.files.length} file${todo.files.length === 1 ? "" : "s"}`}
					</span>
				</p>
			</DialogHeader>
			<SectionTabs
				value={tab}
				onValueChange={setTab}
				tabs={
					<>
						<SectionTab value="overview">Overview</SectionTab>
						<SectionTab value="details">Details</SectionTab>
					</>
				}
			>
				<Section value="overview" keepMounted>
					<div className="flex min-w-0 flex-col gap-3">
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
					</div>
				</Section>
				<Section value="details">
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
				</Section>
			</SectionTabs>
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
					{todo.takenBy === null && (
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

/** How each stage reads, in the task dialog's tones. */
const STAGE_TONES: Record<ReturnType<typeof stageOf>, Tone> = {
	running: "working",
	queued: "working",
	ready: "ready",
	backlog: "quiet",
};

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
			<Markdown text={detail.value} />
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
