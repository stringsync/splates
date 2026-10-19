import { DETAIL_CHARS } from "./classify";

/**
 * A short hash of what `classify` reads of a task, the same for the same
 * subject and judged detail, for a caller to keep classifications by.
 */
export function classificationKey(subject: string, detail: string): string {
	return Bun.hash(
		JSON.stringify([subject, detail.slice(0, DETAIL_CHARS)]),
	).toString(36);
}
