import { type AttachmentInfo, DETAIL_CHARS, namedPaths } from "./classify";

/**
 * A short hash of what `classify` reads of a task, the same for the same
 * subject and judged detail, for a caller to keep classifications by.
 */
export function classificationKey(
	subject: string,
	detail: string,
	attachments: readonly AttachmentInfo[] = [],
): string {
	return Bun.hash(
		JSON.stringify([
			2,
			subject,
			detail.slice(0, DETAIL_CHARS),
			namedPaths(`${subject}\n${detail}`),
			attachments,
		]),
	).toString(36);
}
