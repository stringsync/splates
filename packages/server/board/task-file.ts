import { queuedOf, type StoredTask } from "./store";
import { type TaskRecord, wording } from "./task";

/**
 * A task as the list reads it, with any tags it was saved with, and whether
 * the list shows it at all; null when it will not parse.
 */
export function parseTaskFile(
	raw: string,
): { state: TaskRecord; tags: string[]; listed: boolean } | null {
	try {
		// One saved before tasks took files has none, rather than no list; one
		// saved before they had subjects has its first line as one; one saved
		// before they had positions has 0 until `all` places it; and one saved
		// before links and lanes is blocked by nothing, in none.
		const stored = JSON.parse(raw) as StoredTask;
		const { tags = [], ...state } = queuedOf(stored) as Omit<
			TaskRecord,
			"files" | "subject" | "position" | "blockedBy" | "lane"
		> & {
			files?: string[];
			tags?: string[];
			subject?: string;
			position?: number;
			blockedBy?: number[];
			lane?: number | null;
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
			},
			tags,
			listed: stored.listed !== false,
		};
	} catch {
		return null;
	}
}
