import { color } from "core/log";
import type { Task } from "./task";

const STOP = new Set(
	"a an and the of to in on for with by is are be as at it its that this from or not no when so than then".split(
		" ",
	),
);

/** Open tasks whose subject is similar to `subject`. */
export function similarTasks(subject: string, open: Task[]): Task[] {
	return open.filter((task) => overlap(subject, task.subject) >= 0.7);
}

/**
 * The lines warning that `added` has a subject like those of `similar`, or
 * none when no open task is alike: it is still added, and a duplicate worded
 * differently can be missed.
 */
export function similarWarning(added: Task, similar: Task[]): string[] {
	return similar.map(
		(other) =>
			`  ${color.yellow("similar")}: task ${other.id} is open with a similar subject, "${other.subject}": if it asks the same, work from that one; task ${added.id} is added all the same`,
	);
}

/** The words of a subject that carry its meaning, lowercased and crudely stemmed. */
function words(subject: string): Set<string> {
	const found = subject
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((word) => word !== "" && !STOP.has(word))
		.map((word) => word.replace(/(ing|ed|es|s)$/, ""));
	return new Set(found);
}

/** How much of the smaller subject's words the other shares, 0 to 1. */
function overlap(first: string, second: string): number {
	const left = words(first);
	const right = words(second);
	const smaller = Math.min(left.size, right.size);
	if (smaller === 0) {
		return 0;
	}
	let shared = 0;
	for (const word of left) {
		if (right.has(word)) {
			shared++;
		}
	}
	// Two short subjects sharing one word are not alike.
	return shared >= 2 ? shared / smaller : 0;
}
