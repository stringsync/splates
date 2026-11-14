/** The batch, tally and cost splates server reports to the agent whose run evals card started a run, once it is done. */
export interface EvalsDone {
	batch: string;
	summary: string;
}

const DONE =
	/^\[SPLATES EVALS DONE (\S+)\]\n\nThe run your run evals card asked for is done: ([^\n]+)\.\n/u;

/** The finished run `text` tells, or null for any other message. */
export function evalsDoneOf(text: string): EvalsDone | null {
	const found = DONE.exec(text);
	return found === null
		? null
		: { batch: found[1] ?? "", summary: found[2] ?? "" };
}
