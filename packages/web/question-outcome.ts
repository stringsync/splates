import type { TaskReport } from "@splates/server/plans";
import type { Words } from "./splates-event";

/**
 * What the line of questions no longer asking says: how many were asked, as a
 * reply need not answer them, and the task an escalation named.
 */
export function questionOutcome(
	questions: number,
	escalation: TaskReport | null,
): Words {
	const said = `Asked ${questions} ${questions === 1 ? "question" : "questions"}`;
	return escalation === null
		? [said]
		: [said, { kind: "task", task: escalation.task }];
}

/** What a phone's Send says when nothing was written. */
const NOTHING = "Nothing to add.";

/** What a send says. */
export function replyText(text: string): string {
	return text === "" ? NOTHING : text;
}
