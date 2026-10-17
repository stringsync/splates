import { useReactive } from "@webappwiz/react";
import { useState } from "react";
import { Dispatcher, type Eventful } from "webappwiz/events";
import type { Todo, Todos } from "./api";

type TodoEditorEvents = { changed: undefined };

export class TodoEditor implements Eventful<TodoEditorEvents> {
	private readonly dispatcher = new Dispatcher<TodoEditorEvents>();
	readonly events = this.dispatcher.events;
	subject: string;
	busy = false;

	constructor(
		private readonly todos: Todos,
		private readonly todo: Todo,
		private readonly last: number,
	) {
		this.subject = todo.subject;
	}

	get changed(): boolean {
		return this.subject.trim() !== "" && this.subject.trim() !== this.todo.subject;
	}

	get canMoveUp(): boolean {
		return !this.busy && this.todo.position > 1;
	}

	get canMoveDown(): boolean {
		return !this.busy && this.todo.position < this.last;
	}

	setSubject(subject: string): void {
		this.subject = subject;
		this.dispatcher.dispatch("changed");
	}

	async moveTo(position: number): Promise<void> {
		this.busy = true;
		this.dispatcher.dispatch("changed");
		await (this.changed
			? this.todos.update(this.todo.id, { subject: this.subject, position })
			: this.todos.move(this.todo.id, position));
	}
}

export function Edit({ todos, todo, last }: { todos: Todos; todo: Todo; last: number }) {
	const [editor] = useState(() => new TodoEditor(todos, todo, last));
	const { subject, canMoveUp, canMoveDown } = useReactive(
		editor,
		(editor) => ({
			subject: editor.subject,
			canMoveUp: editor.canMoveUp,
			canMoveDown: editor.canMoveDown,
		}),
		["changed"],
	);

	return (
		<form>
			<input value={subject} onChange={(e) => editor.setSubject(e.target.value)} />
			<button type="button" disabled={!canMoveUp} onClick={() => editor.moveTo(1)}>
				Top
			</button>
			<button type="button" disabled={!canMoveDown} onClick={() => editor.moveTo(last)}>
				Bottom
			</button>
		</form>
	);
}
