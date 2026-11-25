import type { EvalAsk } from "../plans/permission";

/** The amounts an eval budget card offers at a tap, besides the one it asks. */
export const EVAL_BUDGET_PRESETS = [5, 10, 20, 50];

/** The amounts a card asking for more offers at a tap, besides the one it asks. */
export const EVAL_TOP_UP_PRESETS = [2, 5, 10];

/** Pre-approved eval budget seeded onto a conversation by the automation that started it. */
export interface EvalBudgetSeed {
	/** Dollars pre-approved for this firing. */
	usd: number;
	/** The automation's id. */
	automation: string;
	/** The automation's name, when it has one. */
	name?: string;
}

/** What a conversation's eval budget cards came to, as the page shows them. */
export interface EvalBudgetView {
	/** Dollars the person approved for the conversation's rounds, all cards together; 0 for none. */
	usd: number;
	/** What the conversation's rounds have cost since its first approval, in dollars. */
	spent: number;
	/** Each card the person answered, by its key: the dollars it added, or null when declined. */
	answers: Record<string, number | null>;
	/** Set when the automation that started the conversation pre-approved its eval budget. */
	seeded?: EvalBudgetSeed;
}

/**
 * Whether a round may start: only when what the conversation has spent plus
 * the most the round can cost fits the budget the person approved. A round
 * with no ceiling to compare never does.
 */
export function fitsEvalBudget(
	budget: number,
	spent: number,
	ceiling: number | null,
): boolean {
	return (
		budget > 0 && ceiling !== null && spent + ceiling <= budget + 0.000_001
	);
}

/**
 * The key naming a run-evals card, the same on the page and the server, so a
 * round the server starts for a card is the one the card then shows.
 * `message` is the message's place among the conversation's sent messages.
 */
export function evalCardKey(
	ask: Pick<EvalAsk, "skill" | "scenarios">,
	title: string | null,
	conversation: string | null,
	message: string | null,
): string {
	return `${ask.skill}:${ask.scenarios.join(",")}:${title ?? ""}:${conversation ?? ""}:${message ?? ""}`;
}
