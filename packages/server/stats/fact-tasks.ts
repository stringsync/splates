import { color, type Logger } from "webappwiz/log";
import type { Tasks } from "../board";
import { addedFacts, wording } from "../board";
import type { Git } from "../git";
import type { Journal } from "../records";
import { factTasks } from "./finding-facts";
import { landed } from "./landed";
import type { Outcomes } from "./outcomes";

/**
 * Queues a task, untriaged, for each of `task`'s gate runs that named failing
 * tests and each test its passing run timed as slow (see `factTasks`),
 * journaled so the conversation that merged it shows each as an "Added" line
 * the person can remove it from. One whose line is queued already is not added
 * again.
 */
export async function addFactTasks(
	{
		git,
		outcomes,
		tasks,
		journal,
		log,
	}: {
		git: Git;
		outcomes: Outcomes;
		tasks: Tasks;
		journal: Journal;
		log: Logger;
	},
	task: string,
): Promise<void> {
	const merged = landed(await outcomes.list(), git.root, task);
	if (merged === null) {
		return;
	}
	const listed = new Set((await tasks.all()).map((each) => each.subject));
	for (const fact of factTasks(merged)) {
		const { subject, text } = wording(fact.subject, fact.text);
		if (listed.has(subject)) {
			continue;
		}
		listed.add(subject);
		const added = await journal.record(
			"task add",
			task,
			() => tasks.add(subject, task, { text }),
			addedFacts,
		);
		log.info(`  ${color.green("found")} task ${added.id}: ${subject}`);
	}
}
