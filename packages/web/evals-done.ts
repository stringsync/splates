import type { SplatesEventView } from "./splates-event";

/**
 * What splates server tells the agent whose run evals card started a run,
 * once it is done, read back from its words (`evalsDonePrompt` in the
 * server's `evals/done.ts`): the batch, and its tally and cost.
 */
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

/** The line a finished run draws, opening its report, the whole message on hover. */
export function evalsDoneLine(
	done: EvalsDone,
	at: string | null,
	title: string,
): SplatesEventView {
	return {
		words: ["Evals done:", done.summary],
		at,
		title,
		act: {
			label: "Open report",
			run: () => {
				location.hash = `#evals/${encodeURIComponent(done.batch)}`;
			},
		},
	};
}
