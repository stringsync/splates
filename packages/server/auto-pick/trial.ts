import type { Conversations } from "../conversations";
import type { Project } from "../server/shared";
import { type Classification, classify } from "./classify";
import { type AutoPickDecision, decide, decideWithout } from "./decide";
import { judgeFrom } from "./judge";
import { classificationKey } from "./key";
import { type AutoPickTarget, contextOf, recordOf, wordsOf } from "./start";
import type { Judge } from "./system-one";

/** What Auto pick would do for a task, as Setup's "Try it on a task" shows it. */
export interface AutoPickTrial {
	/** The task's subject, as the judge read it. */
	subject: string;
	decision: AutoPickDecision;
	/** What the judge said of the task; null when it said nothing, and why is in the reasons. */
	classification: Classification | null;
	/** Whether that is what the task's record kept from an earlier pick, so no judge was asked. */
	cached: boolean;
}

/**
 * Decides for a task as an Auto pick start would, on the rules saved now,
 * but starts nothing and leaves the task's record as it is: a classification
 * kept on it from an earlier pick of the same words is reused, and one the
 * judge gives now is not kept.
 */
export async function tryAutoPick({
	project,
	conversations,
	target,
	judge = () => judgeFrom(project.creds.credentials),
	now = () => new Date(),
}: {
	project: Project;
	conversations: Conversations;
	target: AutoPickTarget;
	/** The judge to ask; the one the project's creds give by default. */
	judge?: () => Promise<Judge | null>;
	now?: () => Date;
}): Promise<AutoPickTrial> {
	const record = await recordOf(project, target);
	const { subject, detail } = await wordsOf(project, record);
	const context = await contextOf(project, conversations, now());
	const kept = record.autoPick?.classified;
	if (kept?.key === classificationKey(subject, detail)) {
		return {
			subject,
			decision: decide({ ...context, classification: kept.classification }),
			classification: kept.classification,
			cached: true,
		};
	}
	const classified = await classify({ subject, detail, judge: await judge() });
	return classified.ok
		? {
				subject,
				decision: decide({
					...context,
					classification: classified.classification,
				}),
				classification: classified.classification,
				cached: false,
			}
		: {
				subject,
				decision: decideWithout({ ...context, reason: classified.reason }),
				classification: null,
				cached: false,
			};
}
