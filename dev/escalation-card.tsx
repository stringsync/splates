import type { JSX } from "react";
import type { Proposal, Review, TaskReport } from "../asked";
import type { Assumed } from "../assumed";
import type { Demo } from "../demo";
import type { Escalated } from "../events";
import type { Question } from "../plan";
import { InMessage } from "./card-reply";
import { MessageQuestions } from "./message-questions";
import { ReportCard } from "./report-cards";
import { MessageReview } from "./review-panel";

/**
 * What the agent wrote of its escalation in the turn it escalated, which its
 * card takes in rather than drawing a second card: its report, the demo its
 * questions ask about, the calls it says it assumed, its review, or the
 * proposal it waits on with the calls it rests on, which the card asks in
 * place of the task's open questions, since those it chose stand under
 * `## Assumptions`, not `## Blocked`.
 */
export interface Written {
	report: TaskReport | null;
	demo: Demo | null;
	assumed: Assumed[];
	review: Review | null;
	proposal: Proposal | null;
	questions: Question[];
}

/**
 * An escalation as arbor recorded it, whatever the agent wrote: for a review,
 * the Ready to merge card; else the Escalated card asking the task's open
 * questions as they stood, numbered from 1 as a report numbers them, or, with
 * none, saying why it needs the person. What the agent wrote of it in the
 * same turn fills in the sentence, demo and sections arbor cannot know.
 */
export function EscalationCard({
	event,
	written,
}: {
	event: Escalated;
	written: Written | null;
}): JSX.Element {
	const task = event.task ?? "";
	if (event.review) {
		const review = written?.review ?? null;
		return (
			<InMessage>
				<MessageReview
					review={{
						task,
						base: event.base,
						summary: review?.summary || event.about,
						demo: review?.demo ?? null,
						checks: review?.checks ?? [],
						failed: review?.failed ?? [],
						details: review?.details ?? "",
					}}
				/>
			</InMessage>
		);
	}
	const report = written?.report ?? null;
	const escalation: TaskReport = {
		ending: "escalated",
		task,
		base: null,
		to: null,
		reason: event.about,
		body: report?.body ?? "",
		source: report?.source ?? `## ⚠️ Escalated ${task}: ${event.about}`,
	};
	const assumed = written?.assumed ?? [];
	const proposal = written?.proposal ?? null;
	if (
		proposal === null &&
		event.questions.length === 0 &&
		assumed.length === 0
	) {
		return <ReportCard report={escalation} />;
	}
	return (
		<InMessage>
			<MessageQuestions
				questions={
					proposal === null
						? event.questions.map((asked, at) => ({
								...asked,
								number: String(at + 1),
							}))
						: (written?.questions ?? [])
				}
				escalation={escalation}
				proposal={proposal}
				demo={written?.demo ?? null}
				assumed={assumed}
				task={task}
			/>
		</InMessage>
	);
}
