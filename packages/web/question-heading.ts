import type { PlanCard, TaskReport } from "@splates/server/plans";
import type { LucideIcon } from "lucide-react";
import { FileTextIcon, TriangleAlertIcon } from "lucide-react";
import { ENDINGS, type Tone } from "./card-shell";

/** What heads a questions card, on the page and on a phone's sheet alike. */
export interface QuestionHeading {
	/** Its accessible name, which tests and the sheet's list find it by. */
	label: string;
	title: string;
	Icon: LucideIcon;
	tone: Tone;
	/** The task an old escalation names, shown as a pill; unset for the rest. */
	task?: string;
}

/**
 * The heading for a questions card: the escalation's when it ends one, the
 * plan's when they decide one, otherwise "questions for you", with `count`
 * saying how many on a phone's sheet.
 */
export function questionHeading(
	questions: number,
	escalation: TaskReport | null,
	count?: string,
	plan: PlanCard | null = null,
): QuestionHeading {
	if (escalation !== null) {
		return {
			label: `escalated ${escalation.task}`,
			...ENDINGS.escalated,
			...(count === undefined ? {} : { title: `${count} for you` }),
			task: escalation.task,
		};
	}
	if (plan !== null) {
		return {
			// Found as questions are: a plan is what they ask about.
			label: "questions for you",
			Icon: FileTextIcon,
			// The card says only that it is a plan; its Goal says what for.
			title: count !== undefined ? "A plan for you" : "Plan",
			tone: "plan",
		};
	}
	return {
		label: "questions for you",
		Icon: TriangleAlertIcon,
		title:
			count === undefined
				? `${questions === 1 ? "A question" : "Questions"} for you`
				: `${count} for you`,
		tone: "warning",
	};
}
