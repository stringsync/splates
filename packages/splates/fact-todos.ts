import { color, type Logger } from "webappwiz/log";
import { factTodos } from "./finding-facts";
import type { Git } from "./git";
import type { Journal } from "./journal";
import { landed } from "./landed";
import type { Outcomes } from "./outcomes";
import { wording } from "./todo";
import { addedFacts } from "./todo-edit";
import type { Todos } from "./todos";

/**
 * Adds a todo, untriaged, for each thing that went worse in `task`'s merge,
 * as its merged card lists them, journaled so the conversation that merged
 * it shows each as an "Added" line the person can remove it from. One whose
 * line is on the list already is not added again.
 */
export async function addFactTodos(
	{
		git,
		outcomes,
		todos,
		journal,
		log,
	}: {
		git: Git;
		outcomes: Outcomes;
		todos: Todos;
		journal: Journal;
		log: Logger;
	},
	task: string,
): Promise<void> {
	const merged = landed(await outcomes.list(), git.root, task);
	if (merged === null) {
		return;
	}
	const listed = new Set((await todos.all()).map((todo) => todo.subject));
	for (const fact of factTodos(merged)) {
		const { subject, text } = wording(fact.subject, fact.text);
		if (listed.has(subject)) {
			continue;
		}
		listed.add(subject);
		const todo = await journal.record(
			"todo add",
			task,
			() => todos.add(subject, task, { text }),
			addedFacts,
		);
		log.info(`  ${color.green("found")} todo ${todo.id}: ${subject}`);
	}
}
