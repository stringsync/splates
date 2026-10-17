import type { ThreadMessageLike } from "@assistant-ui/react";
import type { Report } from "../asked";
import type { Message } from "../conversations";

export interface ReportTiming {
	at: string;
	until: string | null;
}

/** Stamp working cards from the log, so their durations survive a reload.
 * Only later agent words supersede one; tools and user prompts do not.
 */
export function workingTimes(
	thread: ThreadMessageLike[],
	messages: readonly Message[],
): ThreadMessageLike[] {
	return thread.map((message, index) => {
		if (message.role !== "assistant" || typeof message.content === "string") {
			return message;
		}
		const parts = messages[index]?.parts ?? [];
		return {
			...message,
			content: message.content.map((part) => {
				if (part.type !== "data-report") {
					return part;
				}
				const { report } = part.data as { report: Report };
				if (report.ending !== "working") {
					return part;
				}
				const own = parts.findIndex(
					(each) => each.type === "text" && each.text.includes(report.source),
				);
				const recorded = parts[own];
				if (
					recorded?.type !== "text" ||
					recorded.at == null ||
					!Number.isFinite(Date.parse(recorded.at))
				) {
					return part;
				}
				const later = [
					...parts.slice(own + 1),
					...messages
						.slice(index + 1)
						.filter((each) => each.role === "agent" && !each.queued)
						.flatMap((each) => each.parts),
				].find((each) => each.type === "text" && each.text.trim() !== "");
				const until = later?.type === "text" ? (later.at ?? null) : null;
				return {
					...part,
					data: { report, timing: { at: recorded.at, until } },
				};
			}),
		};
	});
}
