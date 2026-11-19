import { goalOf } from "../plans";

/** Where a candidate stands, which ranks it no higher or lower. */
export type RelatedStatus = "queued" | "started" | "merged" | "removed";

/** A task, in any state, that a new task may be related to. */
export interface Candidate {
	/**
	 * How an agent opens it: `#812` for a queued task (`splates task show`),
	 * a slug for a started or removed one (`splates show`), a short commit for
	 * a merged one (`git show`).
	 */
	ref: string;
	status: RelatedStatus;
	/** Its subject, or the commit's title for a merged task. */
	title: string;
	/** What done means: one or two sentences, "" when it says none. */
	goal: string;
	/** Everything else it says: the why, the files, the steps. */
	details: string;
	/** The files it changes or changed, none when unknown. */
	files: string[];
}

/** What a new task asks, read the same way as a candidate. */
export type Query = Pick<Candidate, "title" | "goal" | "details" | "files">;

/**
 * A task's words split into its goal, one or two sentences on what done
 * means, and the details after it. Takes a queued task's text, in the goal
 * and details shape or the older Before and After one, or a started task's
 * `SPLATES.md`.
 */
export function wordsOf(text: string): { goal: string; details: string } {
	// The only place that knows a task's shape, so a change to it changes
	// only this. An older task and a plan keep the goal under `## After`.
	const after = goalOf(text).trim();
	if (after !== "") {
		const [goal = "", ...rest] = paragraphs(after);
		return {
			goal,
			details: [...rest, withoutAfter(text, after)].join("\n\n").trim(),
		};
	}
	const all = paragraphs(text);
	const index = all.findIndex((each) => !each.startsWith("#"));
	if (index === -1) {
		return { goal: "", details: text.trim() };
	}
	return {
		goal: all[index] ?? "",
		details: [...all.slice(0, index), ...all.slice(index + 1)].join("\n\n"),
	};
}

function paragraphs(text: string): string[] {
	return text
		.split(/\n\s*\n/)
		.map((each) => each.trim())
		.filter((each) => each !== "");
}

function withoutAfter(text: string, after: string): string {
	return text.replace(after, "").trim();
}
