import type { LucideIcon } from "lucide-react";
import { ListChecksIcon, MessageCircleQuestionIcon } from "lucide-react";
import type { Proposal, TaskReport } from "../asked";
import { ENDINGS, type Tone } from "./card-shell";

/** What heads a questions card, on the page and on a phone's sheet alike. */
export interface QuestionHeading {
	/** Its accessible name, which tests and the sheet's list find it by. */
	label: string;
	title: string;
	Icon: LucideIcon;
	tone: Tone;
	/** The task it escalated, shown as a pill; undefined for the rest. */
	task?: string;
	/** What a phone's sheet offers to do in it, where not to answer. */
	action?: string;
}

/**
 * How a questions card is headed: as the escalation it ends, whatever else it
 * holds, since every escalation card reads the same; else as the proposal
 * it rests under; else, with no questions, as the calls assumed; else as the
 * questions for the person, `count` saying how many on a phone's sheet.
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
			Icon: MessageCircleQuestionIcon,
			title: `Questions: ${proposal.subject}`,
			tone: "info",
		};
	}
	if (questions === 0) {
		return {
			label: "assumed",
			Icon: ListChecksIcon,
			title: "Assumed",
			tone: "neutral",
			action: "Review",
		};
	}
	return {
		label: "questions for you",
		Icon: MessageCircleQuestionIcon,
		title:
			count === undefined
				? `${questions === 1 ? "A question" : "Questions"} for you`
				: `${count} for you`,
		tone: "info",
	};
}
