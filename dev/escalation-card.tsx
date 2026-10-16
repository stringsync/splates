import type { JSX } from "react";
import type { Assumed, Review, TaskReport } from "../asked";
import type { Demo } from "../demo";
import type { Escalated } from "../events";
import { InMessage } from "./card-reply";
import { MessageQuestions } from "./message-questions";
import { ReportCard } from "./report-cards";
import { MessageReview } from "./review-panel";

/**
 * What the agent wrote of its escalation in the turn it escalated, which its
 * card takes in rather than drawing a second card: its report, the demo its
 * questions ask about, the calls it says it assumed, or its review.
 */
export interface Written {
	report: TaskReport | null;
	demo: Demo | null;
	assumed: Assumed[];
	review: Review | null;
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
	if (event.questions.length === 0 && assumed.length === 0) {
		return <ReportCard report={escalation} />;
	}
	return (
		<InMessage>
			<MessageQuestions
				questions={event.questions.map((asked, at) => ({
					...asked,
					number: String(at + 1),
				}))}
				escalation={escalation}
				proposal={null}
				demo={written?.demo ?? null}
				assumed={assumed}
				task={task}
			/>
		</InMessage>
	);
}
