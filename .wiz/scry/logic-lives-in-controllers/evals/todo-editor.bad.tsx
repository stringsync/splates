import { useState } from "react";
import { moveTodo, type Todo, updateTodo } from "./api";

export function Edit({ todo, last, onDone }: { todo: Todo; last: number; onDone: () => void }) {
	const [subject, setSubject] = useState(todo.subject);
	const [text, setText] = useState(todo.text);
	const [busy, setBusy] = useState(false);

	const changed =
		subject.trim() !== "" &&
		(subject.trim() !== todo.subject || text.trim() !== todo.text);
	const canMoveUp = !busy && todo.position > 1;
	const canMoveDown = !busy && todo.position < last;

	const move = async (position: number) => {
		if (position < todo.position ? !canMoveUp : !canMoveDown) {
			return;
		}
		setBusy(true);
		if (changed) {
			await updateTodo(todo.id, { subject, text, position });
		} else {
			await moveTodo(todo.id, position);
		}
		onDone();
	};

	return (
		<form>
			<input value={subject} onChange={(e) => setSubject(e.target.value)} />
			<textarea value={text} onChange={(e) => setText(e.target.value)} />
			<button type="button" disabled={!canMoveUp} onClick={() => move(1)}>
				Top
			</button>
			<button type="button" disabled={!canMoveDown} onClick={() => move(last)}>
				Bottom
			</button>
		</form>
	);
}
