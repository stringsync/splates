import { type TodoState, wording } from "./todo";

/** A todo as stored, with any tags it was saved with; null when it will not parse. */
export function parseTodoFile(
	raw: string,
): { state: TodoState; tags: string[] } | null {
	try {
		// One saved before todos took files has none, rather than no list; one
		// saved before they had subjects has its first line as one; one saved
		// before they had positions has 0 until `all` places it; and one saved
		// before links and lanes is blocked by nothing, in none.
		const { tags = [], ...state } = JSON.parse(raw) as Omit<
			TodoState,
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
		};
	} catch {
		return null;
	}
}
