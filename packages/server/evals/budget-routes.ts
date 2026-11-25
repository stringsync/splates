import { z } from "zod";
import { fail } from "../exit";
import { body, type Handler } from "../server/shared";
import type { EvalBudgetView } from "./auto";
import type { EvalRounds } from "./rounds";

/** What the budget routes read and record a conversation's budget with. */
export interface EvalBudgetSources {
	/** Conversation `id`'s budget, its spend and its cards' answers. */
	budget(id: string): Promise<EvalBudgetView>;
	rounds: Pick<EvalRounds, "answer">;
	/** Now, as ISO 8601. */
	now(): string;
}

/** The person's answer to an eval budget card: dollars added, or null for declined. */
const Answer = z.object({
	conversation: z.string().min(1),
	card: z.string().min(1),
	usd: z.number().positive().nullable(),
});

/**
 * How eval budget cards and run cards read a conversation's eval budget,
 * `?conversation=`, and how a budget card records the person's answer.
 */
export class EvalBudgetRoutes {
	constructor(private readonly sources: EvalBudgetSources) {}

	/** `?conversation=`'s budget, what its rounds spent, and its cards' answers. */
	readonly read: Handler = async (request) => {
		const conversation = new URL(request.url).searchParams.get("conversation");
		if (conversation === null || conversation === "") {
			fail("usage", "name the conversation: ?conversation=<id>");
		}
		return Response.json(await this.sources.budget(conversation));
	};

	/** Records the body's answer to a budget card, answering the budget as it now stands. */
	readonly answer: Handler = async (request) => {
		const parsed = Answer.safeParse(await body(request));
		if (!parsed.success) {
			fail(
				"usage",
				"send { conversation, card, usd } with usd a dollar amount, or null to decline",
			);
		}
		const { conversation, card, usd } = parsed.data;
		await this.sources.rounds.answer(
			conversation,
			card,
			usd,
			this.sources.now(),
		);
		return Response.json(await this.sources.budget(conversation));
	};
}
