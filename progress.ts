import { Markdown } from "@webappwiz/md";

const BOX = /^[ \t]*- \[([ xX])\]/gm;

/** The sections that hold the work, so a checklist under Notes cannot skew it. */
const WORK = ["Done", "Next"];

export interface Progress {
	done: number;
	total: number;
}

/**
 * How far along a task is, counted off its `ARBOR.md` checkboxes rather than
 * anything arbor records: the agent moving an item to `## Done` is the only
 * signal there is that a step finished. Null when there is nothing to count,
 * which is a task whose file has no checklist yet.
 */
export function progress(plan: string): Progress | null {
	const md = Markdown.parse(plan);
	const boxes = WORK.flatMap((name) =>
		md.has(name) ? [...md.section(name).body.matchAll(BOX)] : [],
	);
	if (boxes.length === 0) {
		return null;
	}
	return {
		done: boxes.filter((box) => box[1] !== " ").length,
		total: boxes.length,
	};
}
