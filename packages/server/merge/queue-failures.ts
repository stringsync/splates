import type { Logger } from "webappwiz/log";
import { addedFacts, type Tasks, wording } from "../board";
import type { Journal } from "../records";
import type { FailedTest } from "../tasks";
import type { FailureAttribution } from "./attribution";

/** Keep a failing test actionable even when the merge is held without an attempt. */
export async function queueFailedTests(
	{ tasks, log, journal }: { tasks: Tasks; log: Logger; journal?: Journal },
	task: string,
	failed: FailedTest[],
	kind: FailureAttribution,
): Promise<void> {
	try {
		const listed = new Set((await tasks.all()).map((each) => each.subject));
		for (const test of failed) {
			const { subject, text } = wording(
				`Tests failed: ${test.name}`,
				[
					`Found while merging \`${task}\`. Attribution: ${kind}.`,
					"",
					test.message,
				].join("\n"),
			);
			if (listed.has(subject)) {
				continue;
			}
			listed.add(subject);
			const add = () => tasks.add(subject, task, { text });
			const added = journal
				? await journal.record("task add", task, add, addedFacts)
				: await add();
			log.info(`  found task ${added.id}: ${subject}`);
		}
	} catch (error) {
		log.error(`Could not queue failing-test tasks: ${String(error)}`);
	}
}
