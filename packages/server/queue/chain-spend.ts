/** What the out-of-budget question says about its chain, read from its words. */
export interface ChainSpend {
	chain: string;
	spent: string;
	budget: string;
	/** Spent as a share of the budget, from 0 to 1. */
	share: number;
}

const ASKED = /^How much more may the (.+) chain spend\??$/;
const SAID = /\bspent ([\d.]+)M of ([\d.]+)M\b/;

/**
 * Reads the chain's meter from the out-of-budget question an agent writes
 * (`How much more may the <chain> chain spend?` over `It spent 5.0M of 5M`),
 * or null for any other question: the page only adds the meter to the plain
 * message.
 */
export function chainSpendOf(text: string, body: string): ChainSpend | null {
	const asked = ASKED.exec(text.trim());
	const said = SAID.exec(body);
	if (asked === null || said === null) {
		return null;
	}
	const spent = Number(said[1]);
	const budget = Number(said[2]);
	return {
		chain: asked[1] as string,
		spent: `${said[1]}M`,
		budget: `${said[2]}M`,
		share: budget > 0 ? Math.min(1, spent / budget) : 1,
	};
}
