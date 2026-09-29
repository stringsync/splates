import { ListTodoIcon } from "lucide-react";
import { type FormEvent, type JSX, useState } from "react";
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
} from "#dev/components/ui/input-group.tsx";
import { toast } from "#dev/components/ui/toast.tsx";
import { age } from "../age";
import type { Snapshot } from "../snapshot";
import type { TodoState } from "../todo";
import { addTodo } from "./api";

/**
 * Work deferred for later, oldest first, and a line to add to it. Picking one
 * up takes an agent (`arbor add <task> --todo <id>`), so the page only shows
 * which are waiting, which are taken, and which have waited too long.
 */
export function Todos({ snapshot }: { snapshot: Snapshot }): JSX.Element {
	const { todos, todoStalenessMs } = snapshot;
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
				<ul className="flex flex-col gap-3">
					{todos.map((todo) => (
						<Todo key={todo.id} todo={todo} staleness={todoStalenessMs} />
					))}
				</ul>
			)}
		</div>
	);
}

function Todo({
	todo,
	staleness,
}: {
	todo: TodoState;
	staleness: number;
}): JSX.Element {
	const stale =
		todo.takenBy === null &&
		Date.now() - Date.parse(todo.createdAt) > staleness;
	const meta = [
		todo.takenBy ? `taken by ${todo.takenBy}` : null,
		todo.from ? `from ${todo.from}` : null,
		age(todo.createdAt),
		stale ? "stale" : null,
	].filter(Boolean);
	return (
		<li className="flex items-baseline gap-3">
			<span className="w-7 shrink-0 text-muted-foreground text-xs tabular-nums">
				{todo.id}
			</span>
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span
					className={
						todo.takenBy || stale ? "text-muted-foreground text-sm" : "text-sm"
					}
				>
					{todo.text}
				</span>
				<span className="text-muted-foreground text-xs">
					{meta.join(" · ")}
				</span>
			</div>
		</li>
	);
}

function Add(): JSX.Element {
	const [text, setText] = useState("");
	const [sending, setSending] = useState(false);

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (text.trim() === "" || sending) {
			return;
		}
		setSending(true);
		try {
			await addTodo(text);
			setText("");
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
		<form onSubmit={submit}>
			<InputGroup>
				<InputGroupInput
					aria-label="new todo"
					placeholder="Something to do later"
					value={text}
					onChange={(event) => setText(event.target.value)}
				/>
				<InputGroupAddon align="inline-end">
					<InputGroupButton
						type="submit"
						variant="secondary"
						disabled={text.trim() === "" || sending}
					>
						Add
					</InputGroupButton>
				</InputGroupAddon>
			</InputGroup>
		</form>
	);
}
