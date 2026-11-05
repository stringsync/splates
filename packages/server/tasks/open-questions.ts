import type { Conversations } from "../conversations";
import { openCards, type Question } from "../plans";

/**
 * The question cards a task's conversations asked that no reply has
 * answered, read from their messages; none when conversations are off.
 */
export async function openQuestions(
	conversations: Conversations | null,
	task: string,
): Promise<Question[]> {
	const on = (await (conversations?.list() ?? [])).filter(
		(each) => each.state.task === task && !each.state.archived,
	);
	return on.flatMap((each) => {
		const began = each.state.events.findLast(
			(event) =>
				event.action === "add" && event.task === task && event.reason === null,
		)?.at;
		return openCards(
			each.state.messages.filter(
				(message) =>
					began === undefined || message.at === null || message.at >= began,
			),
		);
	});
}
