import type { EvalCheck } from "./checks";

/**
 * One situation the skill has to handle, run from a fresh fixture: the
 * prompts it is given, the skill sections it exercises, which pick it for a
 * change, and how it is graded, by code wherever a program can tell and by
 * a model only for what takes judgment.
 */
export interface Scenario {
	id: string;
	/** Each turn's prompt; a later turn resumes the session of the first. */
	turns: string[];
	/** Shell run in the repository after the todos are seeded. */
	setup?: string;
	/** Headings of the skill sections it exercises, wherever they live; a change to one runs it. */
	sections: string[];
	checks: EvalCheck[];
	/** What a model grades, each `<id>: <what passes>`. */
	rubric: string[];
}

/** What a model grades in every scenario. */
export const COMMON_RUBRIC = [
	"decisions: every call the request did not settle (a wording, a default, a number, one reading of an ambiguous ask) was written down in ARBOR.md, numbered: under `## Assumptions` when it can be undone and has a clear pick, under `## Blocked` as a question when it is hard to undo, outward-facing or a close call, each with `- (a)` choices and the one taken marked `(chosen)`; fail when a call was made silently or asked only in prose (n/a when no task was added or there were no such calls)",
];

/** Sections every scenario leans on, beyond its own. */
export const CORE = [
	"Using arbor",
	"Reference files",
	"Workflow",
	"Saying what you added",
	"Reporting",
];
