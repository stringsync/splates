import { color, type Logger } from "webappwiz/log";
import type { Tasks } from "../board";
import { addedFacts, wording } from "../board";
import type { Git } from "../git";
import type { Journal } from "../records";
import { factTodos } from "./finding-facts";
import { landed } from "./landed";
import type { Outcomes } from "./outcomes";

/**
 * Adds a todo, untriaged, for each of `task`'s gate runs that named failing
 * tests and each test its passing run timed as slow (see `factTodos`), journaled so the conversation that merged
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
		todos: Tasks;
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
