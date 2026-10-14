import { useReactive } from "@webappwiz/react";
import { Trash2Icon } from "lucide-react";
import { type JSX, useContext, useState } from "react";
import { Button } from "#dev/components/ui/button.tsx";
import {
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#dev/components/ui/dialog.tsx";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
	InputGroupTextarea,
} from "#dev/components/ui/input-group.tsx";
import type { TodoState } from "../todo";
import { assignTodo } from "./api";
import { Board as BoardContext } from "./board";
import { CopyLink } from "./card";
import { AssigneeMenu, OnIt, StartMenu } from "./dispatching";
import { todoEdit } from "./drafts";
import { AttachButton, Dropped, FileList } from "./files";
import { Links } from "./links";
import { Markdown } from "./markdown";
import { MentionAnchor, useMentions } from "./mentions";
import { Refusal, useRefusal } from "./refusal";
import { TodoEditor } from "./todo-editor";

/**
 * One todo opened: its words and files to change, where it sits on the board
 * and what it waits on, between its subject and detail, and a way to drop it.
 */
export function Edit({
	todo,
	onDone,
}: {
	todo: TodoState;
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
	const settle = (writing: Promise<void> | null, failed: string): void => {
		writing?.then(onDone, (error: unknown) => refuse(failed, error));
	};
	return (
		<>
			<DialogHeader>
				<DialogTitle className="flex items-center gap-2">
					Todo {todo.id}
					<span className="font-normal text-muted-foreground text-xs">
						<CopyLink id={todo.id} />
					</span>
				</DialogTitle>
				<DialogDescription>
					{todo.takenBy ? `Taken by ${todo.takenBy}` : place}
				</DialogDescription>
			</DialogHeader>
			<div className="flex min-w-0 flex-col gap-3">
				{restored && (
					<p className="flex items-center gap-2 text-muted-foreground text-xs">
						Unsaved changes kept from before
						<Button size="xs" variant="ghost" onClick={() => editor.discard()}>
							Discard
						</Button>
					</p>
				)}
				<MentionAnchor mentions={mentions}>
					<InputGroup>
						<InputGroupInput
							ref={mentions.ref}
							aria-label="subject"
							value={mentions.value}
							onChange={mentions.onChange}
							onSelect={mentions.onSelect}
							onClick={mentions.onClick}
							onKeyDown={mentions.onKeyDown}
							onPaste={(event) => editor.files.paste(event)}
						/>
					</InputGroup>
				</MentionAnchor>
				{todo.takenBy === null ? (
					<div className="flex flex-wrap items-center gap-2">
						<StartMenu
							assignment={{ kind: "todo", id: todo.id }}
							assignee={todo.assignee ?? null}
							onStart={onDone}
						/>
						<AssigneeMenu
							assignee={todo.assignee ?? null}
							onPick={(pick) =>
								void assignTodo(todo.id, pick).catch((error: unknown) =>
									refuse("Not assigned", error),
								)
							}
						/>
					</div>
				) : (
					<OnIt task={todo.takenBy} variant="rows" className="-mx-2" />
				)}
				<Links todo={todo} />
				<Detail editor={editor} />
				<FileList files={editor.files} />
				<Dropped names={dropped} />
				<Refusal refusal={refusal} className="text-right" />
			</div>
			<DialogFooter className="flex-row justify-between sm:justify-between">
				<Button
					variant={confirming ? "destructive" : "ghost"}
					disabled={busy}
					onClick={() => settle(editor.remove(), "Not removed")}
				>
					<Trash2Icon data-icon="inline-start" />
					{confirming ? "Remove for good" : "Remove"}
				</Button>
				<Button
					disabled={!changed || busy}
					onClick={() => settle(editor.save(), "Not saved")}
				>
					Save
				</Button>
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
						<AttachButton files={editor.files} />
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
