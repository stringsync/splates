import type { SplatesEventView } from "./splates-event";

/** Identifies a completed eval run and its result summary. */
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
		words: ["Finished"],
		at,
		title,
		act: {
			label: "Eval report",
			run: () => {
				location.hash = `#evals/${encodeURIComponent(done.batch)}`;
			},
		},
	};
}
