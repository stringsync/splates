import type { TaskRecord } from "../board";
import { type AttachmentInfo, type Classification, classify } from "./classify";
import {
	type AutoPickDecision,
	type DecideContext,
	decide,
	decideWithout,
} from "./decide";
import type { AutoPicked } from "./record";
import type { Judge } from "./system-one";

/** What Auto pick decided for a task's words, and what the judge said of them. */
export interface Judged {
	decision: AutoPickDecision;
	/** What the judge said of the words, now or before; null when it said nothing. */
	classification: Classification | null;
	/** Whether there was a judge to ask; without one, its key is asked for. */
	judged: boolean;
}

/**
 * Decides for a task's words: on `cached`, what the judge said of the same
 * words before, with no judge asked; else on what `judge` says now; else, the
 * judge missing, failing or slow, on the rule for any task, saying why.
 */
export async function decideFor({
	subject,
	detail,
	attachments,
	cached,
	judge,
	context,
}: {
	subject: string;
	detail: string;
	attachments?: readonly AttachmentInfo[];
	cached: Classification | null;
	judge: () => Promise<Judge | null>;
	context: DecideContext;
}): Promise<Judged> {
	if (cached !== null) {
		return {
			decision: decide({ ...context, classification: cached }),
			classification: cached,
			judged: true,
		};
	}
	const asked = await judge();
	const classified = await classify({
		subject,
		detail,
		attachments,
		judge: asked,
	});
	return classified.ok
		? {
				decision: decide({
					...context,
					classification: classified.classification,
				}),
				classification: classified.classification,
				judged: true,
			}
		: {
				decision: decideWithout({ ...context, reason: classified.reason }),
				classification: null,
				judged: asked !== null,
			};
}

/** What the judge said of `record`'s words before, kept on it under `key`; null for none. */
export function cachedFor(
	record: TaskRecord,
	key: string,
): Classification | null {
	const kept = record.autoPick?.classified;
	return kept?.key === key ? kept.classification : null;
}

/** `judged` as a task's record keeps it, decided `at`, its words' classification under `key`. */
export function autoPicked(
	{ decision, classification }: Judged,
	key: string,
	at: Date,
): AutoPicked {
	return {
		...decision,
		at: at.toISOString(),
		...(classification === null ? {} : { classified: { key, classification } }),
	};
}
