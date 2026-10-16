import { CheckIcon, ClockIcon } from "lucide-react";
import { type JSX, useContext, useState } from "react";
import { Button } from "#dev/components/ui/button.tsx";
import { addTodo, type TodoForm } from "./api";
import { Board } from "./board";
import { Refusal, useRefusal } from "./refusal";

/**
 * Makes `todo` of one finding, untriaged, then says Deferred in its place:
 * so while a todo by that line is on the list, after a reload too. The only
 * way a finding becomes a todo: the person's call, never the agent's.
 */
export function DeferButton({ todo }: { todo: TodoForm }): JSX.Element {
	const board = useContext(Board);
	const [made, setMade] = useState(false);
	const { refusal, attempt } = useRefusal();
	if (made || board.todos.some((each) => each.subject === todo.subject)) {
		return (
			<span className="flex shrink-0 items-center gap-1 text-success">
				<CheckIcon className="size-3.5" strokeWidth={3} />
				Deferred
			</span>
		);
	}
	return (
		<span className="flex shrink-0 flex-col items-end">
			<Button
				size="xs"
				variant="ghost"
				onClick={async () =>
					setMade(await attempt(addTodo(todo, []), "Not deferred"))
				}
				className="h-6 gap-1 pointer-coarse:h-10 text-muted-foreground"
			>
				<ClockIcon data-icon="inline-start" />
				Defer
			</Button>
			<Refusal refusal={refusal} />
		</span>
	);
}
