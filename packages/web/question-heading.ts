import type { Proposal, TaskReport } from "@stringsync/splates-server/plans";
import type { LucideIcon } from "lucide-react";
import { TriangleAlertIcon } from "lucide-react";
import { ENDINGS, type Tone } from "./card-shell";

/** What heads a questions card, on the page and on a phone's sheet alike. */
export interface QuestionHeading {
	/** Its accessible name, which tests and the sheet's list find it by. */
	label: string;
	title: string;
	Icon: LucideIcon;
	tone: Tone;
	/**
	 * The task it escalated, from before escalating was retired, shown as a
	 * pill; undefined for the rest.
	 */
	task?: string;
}

/**
 * How a questions card is headed: as the escalation it ends, in a
 * conversation from before escalating was retired, whatever else it holds,
 * since every escalation card reads the same; else as the proposal
 * it rests under; else as the questions for the person, `count` saying how many on a phone's sheet.
 */
export function questionHeading(
	questions: number,
	escalation: TaskReport | null,
	proposal: Proposal | null,
	count?: string,
): QuestionHeading {
	if (escalation !== null) {
		return {
			label: `escalated ${escalation.task}`,
			...ENDINGS.escalated,
			...(count === undefined ? {} : { title: `${count} for you` }),
			task: escalation.task,
		};
	}
	if (proposal !== null) {
		return {
			label: `proposal ${proposal.subject}`,
			Icon: TriangleAlertIcon,
			title: `Questions: ${proposal.subject}`,
			tone: "warning",
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
