import type { Conversations } from "../conversations";
import type { Project } from "../server/shared";
import { type Classification, classify } from "./classify";
import { type AutopickDecision, decide, decideWithout } from "./decide";
import { type JudgeFor, projectJudge } from "./judge";
import { classificationKey } from "./key";
import { type AutopickTarget, contextOf, recordOf, wordsOf } from "./start";

/** What Autopick would do for a task, as Setup's "Try it on a task" shows it. */
export interface AutopickTrial {
	/** The task's subject, as the judge read it. */
	subject: string;
	decision: AutopickDecision;
	/** What the judge said of the task; null when it said nothing, and why is in the reasons. */
	classification: Classification | null;
	/** Whether that is what the task's record kept from an earlier pick, so no judge was asked. */
	cached: boolean;
}

/**
 * Decides for a task as an Autopick start would, on the rules saved now,
 * but starts nothing and leaves the task's record as it is: a classification
 * kept on it from an earlier pick of the same words is reused, and one the
 * judge gives now is not kept.
 */
export async function tryAutopick({
	project,
	conversations,
	target,
	slug = async () => null,
	judge = (who) => projectJudge(project, slug, who),
	now = () => new Date(),
}: {
	project: Project;
	conversations: Conversations;
	target: AutopickTarget;
	/** The judge to ask; the one the project's creds give by default. */
	judge?: JudgeFor;
	/** The project's slug, to name it in the spend ledger; none when not given. */
	slug?: () => Promise<string | null>;
	now?: () => Date;
}): Promise<AutopickTrial> {
	const record = await recordOf(project, target);
	const { subject, detail } = await wordsOf(project, record);
	const attachments = record.files.map((name) => ({
		name,
		mimeType: Bun.file(name).type,
	}));
	const context = await contextOf(project, conversations, now(), attachments);
	const kept = record.autoPick?.classified;
	if (kept?.key === classificationKey(subject, detail, attachments)) {
		return {
			subject,
			decision: decide({ ...context, classification: kept.classification }),
			classification: kept.classification,
			cached: true,
		};
	}
	const classified = await classify({
		subject,
		detail,
		attachments,
		judge: await judge({
			task: "task" in target ? target.task : `#${target.todo}`,
		}),
	});
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
