import { type EvalProposal, evalProposalOf } from "./eval-proposal";

/** A question's body split into the eval it shows and the words left around it. */
export interface EvalQuestion {
	proposal: EvalProposal;
	/** The body without the eval's fence. */
	rest: string;
}

const FENCE = /^([ \t]*)(`{3,}|~{3,})eval[ \t]*\n([\s\S]*?)\n[ \t]*\2[ \t]*$/m;

/**
 * The eval a question's `body` holds in an `eval` fence, drawn as its own
 * card apart from the question; null when it holds none, or one that does not
 * parse.
 */
export function evalQuestionOf(body: string): EvalQuestion | null {
	const found = FENCE.exec(body);
	if (found === null) {
		return null;
	}
	const proposal = evalProposalOf(found[3] ?? "");
	if (proposal === null) {
		return null;
	}
	const rest = (
		body.slice(0, found.index) + body.slice(found.index + found[0].length)
	)
		.replace(/\n{3,}/g, "\n\n")
		.trim();
	return { proposal, rest };
}
