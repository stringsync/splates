import { type Catalog, catalogKey, priced } from "../prices";
import type { SpendKind } from "./totals";

/** What a conversation had used by some moment, as its state tallies it. */
export interface Used {
	/** Tokens read over every turn, those from cache among them. */
	input: number;
	cached: number;
	output: number;
	/** What the agent says the session cost, in dollars; null for one that never says. */
	cost: number | null;
	/** Tokens in the context window; null until said. */
	context: number | null;
}

/** An agent turn's tokens in the shape OpenCode observes them, one per turn. */
export interface TurnTokens {
	model: string | null;
	input: number;
	cachedRead: number;
	cachedWrite: number;
	output: number;
}

/**
 * How each agent's use is paid for: Claude, Codex and Kimi are used through a
 * subscription, so their dollars are what the API would have charged;
 * OpenCode bills by use.
 */
export const KINDS: Record<string, SpendKind> = {
	claude: "equivalent",
	codex: "equivalent",
	kimi: "equivalent",
	opencode: "billed",
};

/** What one turn cost in dollars, and the kind of money it is; null when unpriceable. */
export interface TurnSpend {
	dollars: number;
	kind: SpendKind;
}

/**
 * Prices the turn that took a conversation from `before` to `after`: at the
 * cost the agent said it ran up in between, else its tokens at the model's
 * API list price in `catalog`. Null when the turn cost nothing, or nothing
 * is known to price it by.
 */
export function turnSpend(
	agent: string,
	model: string | null,
	before: Used,
	after: Used,
	catalog: Catalog | null,
	observed: readonly TurnTokens[] = [],
	kinds: Record<string, SpendKind> = KINDS,
): TurnSpend | null {
	const kind = kinds[agent] ?? "billed";
	if (after.cost !== null) {
		// A figure below the last starts a new count, as in a new process.
		const said =
			after.cost >= (before.cost ?? 0) ? after.cost - (before.cost ?? 0) : 0;
		return said > 0 ? { dollars: said, kind } : null;
	}
	if (catalog === null) {
		return null;
	}
	let dollars = 0;
	if (observed.length > 0) {
		for (const turn of observed) {
			const price = catalog[catalogKey(agent, turn.model) ?? ""];
			if (price === undefined) {
				return null;
			}
			dollars += priced(price, { ...turn, context: null });
		}
	} else {
		const price = catalog[catalogKey(agent, model) ?? ""];
		if (price === undefined) {
			return null;
		}
		const read = after.cached - before.cached;
		dollars = priced(price, {
			input: after.input - before.input - read,
			cachedRead: read,
			cachedWrite: 0,
			output: after.output - before.output,
			context: after.context,
		});
	}
	return dollars > 0 ? { dollars, kind } : null;
}
