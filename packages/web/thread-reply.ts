import type { ThreadMessageLike } from "@assistant-ui/react";
import {
	type Review,
	type Stretch,
	stretches,
	type TaskReport,
} from "@stringsync/splates-server/plans/browser";
import type { Event } from "@stringsync/splates-server/records";
import { isEscalation } from "@stringsync/splates-server/records/browser";
import type { Written } from "./escalation-card";
import type { QuestionsData } from "./message-questions";
import type { Turn } from "./report-cards";

type LikePart = Exclude<ThreadMessageLike["content"], string>[number];

/**
 * `parts` with what the agent wrote of the last escalation splates recorded in
 * them, its report, the questions it ends with and their demo, its review,
 * or the proposal it escalated to wait on, taken into the escalation's card
 * rather than drawn as a second one.
 */
export function withEscalation(parts: LikePart[]): LikePart[] {
	const escalatedIn = (part: LikePart): { event: Event } | null => {
		if (part.type !== "data-event") {
			return null;
		}
		const data = part.data as { event: Event };
		return isEscalation(data.event) ? data : null;
	};
	const at = parts.findLastIndex((part) => escalatedIn(part) !== null);
	const data = at === -1 ? null : escalatedIn(parts[at] as LikePart);
	if (data === null) {
		return parts;
	}
	const { event } = data;
	const written: Written = {
		report: null,
		demo: null,
		review: null,
		proposal: null,
		questions: [],
	};
	const kept = parts.filter((part, index) => {
		if (index === at) {
			return true;
		}
		if (part.type === "data-report") {
			const { report } = part.data as { report: TaskReport };
			if (report.ending === "escalated" && report.task === event.task) {
				written.report = report;
				return false;
			}
		}
		if (part.type === "data-questions") {
			const { questions, escalation, proposal, demo, task } =
				part.data as QuestionsData;
			if (escalation?.task === event.task) {
				written.report = escalation;
				written.demo = demo;
				return false;
			}
			// A proposal names no task of its own: the turn's is the escalation's,
			// where the log can say it at all.
			if (proposal !== null && (task === null || task === event.task)) {
				written.proposal = proposal;
				written.questions = questions;
				written.demo = demo;
				return false;
			}
		}
		if (part.type === "data-review") {
			const { review } = part.data as { review: Review };
			if (review.task === event.task) {
				written.review = review;
				return false;
			}
		}
		return true;
	});
	return kept.map((part) =>
		part === parts[at]
			? {
					type: "data-event" as const,
					data: { ...data, written },
				}
			: part,
	);
}

/**
 * Each event by the index of the agent's turn it came in: the turn going at
 * the time, or the one answering a prompt it followed or came before, which
 * the reply's place holds until the agent speaks. Each turn's events stay oldest first.
 */
/** The escalation `stretch` reports; null for any other stretch. */
function escalatedIn(stretch: Stretch | undefined): TaskReport | null {
	return stretch?.type === "report" && stretch.report.ending === "escalated"
		? stretch.report
		: null;
}

/**
 * The agent's reply, its questions and review as cards once it has stopped
 * writing them: a list mid-stream may yet turn out not to ask any. An
 * escalation's questions come right after it, or after the demo they ask
 * about, so they are one card: the questions, headed as the escalation, the
 * demo above them. A run of todos is one part, with `turn` to say which
 * of them it added, and `next` whether it follows a merge or remove report.
 */
export function replied(
	text: string,
	settled: boolean,
	turn: Turn,
): LikePart[] {
	if (!settled) {
		return [{ type: "text", text }];
	}
	const all = stretches(text);
	return all.flatMap((stretch, at): LikePart[] => {
		const before = all[at - 1];
		const after = all[at + 1];
		// The questions an escalation or proposal ends, past the demo between.
		const asking = all[at + (after?.type === "demo" ? 2 : 1)];
		switch (stretch.type) {
			case "text":
				return [{ type: "text", text: stretch.text }];
			case "questions": {
				const demo = before?.type === "demo" ? before.demo : null;
				const heading = all[demo === null ? at - 1 : at - 2];
				return [
					{
						type: "data-questions",
						data: {
							questions: stretch.questions,
							escalation: escalatedIn(heading),
							proposal: heading?.type === "proposal" ? heading.proposal : null,
							demo,
							task: turn.task,
						} satisfies QuestionsData,
					},
				];
			}
			case "demo":
				return after?.type === "questions" || before?.type === "proposal"
					? []
					: [{ type: "data-demo", data: { demo: stretch.demo } }];
			case "review":
				return [{ type: "data-review", data: { review: stretch.review } }];
			case "proposal":
				// Its questions are its card; without any, it is a card of its own.
				return asking?.type === "questions"
					? []
					: [
							{
								type: "data-questions",
								data: {
									questions: [],
									escalation: null,
									proposal: stretch.proposal,
									demo: after?.type === "demo" ? after.demo : null,
									task: turn.task,
								} satisfies QuestionsData,
							},
						];
			case "report":
				return stretch.report.ending === "escalated" &&
					asking?.type === "questions"
					? []
					: [{ type: "data-report", data: { report: stretch.report } }];
			case "todo": {
				// A run of todos is one part, to gather those added to a lane.
				if (before?.type === "todo") {
					return [];
				}
				const run = all.slice(at);
				const end = run.findIndex((each) => each.type !== "todo");
				const todos = (end === -1 ? run : run.slice(0, end)).flatMap((each) =>
					each.type === "todo" ? [each.todo] : [],
				);
				// Those right after a task ended are what to take up next.
				const next =
					before?.type === "report" &&
					before.report.ending !== "escalated" &&
					before.report.ending !== "working";
				return [{ type: "data-todo", data: { todos, turn, next } }];
			}
			case "permission":
				return [
					{
						type: "data-permission",
						data: { permission: stretch.permission },
					},
				];
			default:
				return stretch satisfies never;
		}
	});
}
