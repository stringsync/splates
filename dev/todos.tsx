import { ListTodoIcon, Trash2Icon } from "lucide-react";
import { type FormEvent, type JSX, useState } from "react";
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
import { age } from "../age";
import type { Snapshot } from "../snapshot";
import type { TodoState } from "../todo";
import { addTodo, removeTodo, updateTodo } from "./api";
import { AttachButton, FileList, useFiles } from "./files";
import { MentionAnchor, useMentions } from "./mentions";

/**
 * Work deferred for later, oldest first, and a line to add to it. Picking one
 * up takes an agent (`arbor add <task> --todo <id>`), so the page shows which
 * are waiting, which are taken, and which have waited too long, and a tap
 * opens one to reword or remove.
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
				<ul className="flex flex-col gap-1">
					{todos.map((todo) => (
						<Todo
							key={todo.id}
							todo={todo}
							staleness={todoStalenessMs}
							onOpen={() => setOpened(todo.id)}
						/>
					))}
				</ul>
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

function Todo({
	todo,
	staleness,
	onOpen,
}: {
	todo: TodoState;
	staleness: number;
	onOpen: () => void;
}): JSX.Element {
	const stale =
		todo.takenBy === null &&
		Date.now() - Date.parse(todo.createdAt) > staleness;
	const meta = [
		todo.files.length > 0
			? `${todo.files.length} file${todo.files.length === 1 ? "" : "s"}`
			: null,
		todo.takenBy ? `taken by ${todo.takenBy}` : null,
		todo.from ? `from ${todo.from}` : null,
		age(todo.createdAt),
		stale ? "stale" : null,
	].filter(Boolean);
	return (
		<li>
			<button
				type="button"
				onClick={onOpen}
				className="-mx-2 flex w-[calc(100%+1rem)] items-baseline gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-muted"
			>
				<span className="w-7 shrink-0 text-muted-foreground text-xs tabular-nums">
					{todo.id}
				</span>
				<div className="flex min-w-0 flex-1 flex-col gap-0.5">
					<span
						className={
							todo.takenBy || stale
								? "text-muted-foreground text-sm"
								: "text-sm"
						}
					>
						{todo.text}
					</span>
					<span className="text-muted-foreground text-xs">
						{meta.join(" · ")}
					</span>
				</div>
			</button>
		</li>
	);
}

function Add(): JSX.Element {
	const [text, setText] = useState("");
	const files = useFiles();
	const mentions = useMentions<HTMLInputElement>({ task: "", text, setText });
	const [sending, setSending] = useState(false);

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (text.trim() === "" || sending) {
			return;
		}
		setSending(true);
		try {
			await addTodo(text, files.files);
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
						value={text}
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
							disabled={text.trim() === "" || sending}
						>
							Add
						</InputGroupButton>
					</InputGroupAddon>
				</InputGroup>
			</MentionAnchor>
			<FileList files={files} />
		</form>
	);
}

/** One todo opened: its words to change, and a way to drop it. */
function Edit({
	todo,
	onDone,
}: {
	todo: TodoState;
	onDone: () => void;
}): JSX.Element {
	const [text, setText] = useState(todo.text);
	const files = useFiles(todo.files);
	const mentions = useMentions<HTMLTextAreaElement>({
		task: "",
		text,
		setText,
	});
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
		text.trim() !== "" &&
		(text.trim() !== todo.text ||
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
						: todo.from
							? `From ${todo.from}`
							: "Added by hand"}
				</SheetDescription>
			</SheetHeader>
			<div className="flex flex-col gap-2 px-4">
				<MentionAnchor mentions={mentions}>
					<InputGroup>
						<InputGroupTextarea
							ref={mentions.ref}
							aria-label="todo"
							value={text}
							onChange={mentions.onChange}
							onSelect={mentions.onSelect}
							onClick={mentions.onClick}
							onKeyDown={mentions.onKeyDown}
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
