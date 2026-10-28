import { queuedOf, type StoredTask } from "./store";
import { type TaskRecord, type TaskStage, wording } from "./task";

/** A task's file name under `tasks/`: its number, then `.md`. */
export const TASK_FILE = /^\d+\.md$/;

/** Task `record` as the text of its `tasks/<N>.md`, front matter then body. */
export function encodeTask(record: object): string {
	// JSON escapes every line break inside a string, so no `---` line in the
	// front matter is ever one of its values.
	const { text = "", ...fields } = record as { text?: unknown };
	const body = String(text).trim();
	return `---\n${JSON.stringify(fields, null, "\t")}\n---\n${body === "" ? "" : `${body}\n`}`;
}

/**
 * The fields of a task file `encodeTask` wrote, its body as `text`; null
 * when it will not parse or names no number.
 */
export function decodeTask(raw: string): Record<string, unknown> | null {
	const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw);
	if (match === null) {
		return null;
	}
	try {
		const fields = JSON.parse(match[1] as string) as unknown;
		if (
			fields === null ||
			typeof fields !== "object" ||
			typeof (fields as { id?: unknown }).id !== "number"
		) {
			return null;
		}
		return { ...fields, text: (match[2] as string).trim() };
	} catch {
		return null;
	}
}

/** The stage of a task whose record has none: `ready` when a model is named for it, else `backlog`. */
export function stageOf(state: {
	stage?: TaskStage;
	assignee?: unknown;
}): TaskStage {
	return state.stage ?? (state.assignee === undefined ? "backlog" : "ready");
}

/**
 * A task as the list reads it, with any tags it was saved with, and whether
 * the list shows it at all; null when it will not parse.
 */
export function parseTaskFile(
	raw: string,
): { state: TaskRecord; tags: string[]; listed: boolean } | null {
	const stored = decodeTask(raw) as StoredTask | null;
	if (stored === null) {
		return null;
	}
	// One saved before tasks took files has none, rather than no list; one
	// saved before they had subjects has its first line as one; one saved
	// before they had positions has 0 until `all` places it; and one saved
	// before links and lanes is blocked by nothing, in none. One a running
	// lane once marked stuck drops the mark, which nothing sets now, and one
	// once kept from queued lanes drops that too, as lanes no longer queue.
	const {
		tags = [],
		stuck: _,
		manual: __,
		...state
	} = queuedOf(stored) as Omit<
		TaskRecord,
		"files" | "subject" | "position" | "blockedBy" | "lane" | "stage"
	> & {
		files?: string[];
		tags?: string[];
		subject?: string;
		position?: number;
		blockedBy?: number[];
		lane?: number | null;
		stage?: TaskStage;
		stuck?: string;
		manual?: true;
	};
	return {
		state: {
			...state,
			...(state.subject === undefined
				? wording(state.text, "")
				: { subject: state.subject, text: state.text }),
			position: state.position ?? 0,
			files: state.files ?? [],
			blockedBy: state.blockedBy ?? [],
			lane: state.lane ?? null,
			stage: stored.task === undefined ? stageOf(state) : "running",
		},
		tags,
		listed: stored.listed !== false,
	};
}
