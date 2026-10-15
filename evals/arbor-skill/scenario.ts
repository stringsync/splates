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
	"decisions: every call the request did not settle (a name, a default, a number, one reading of an ambiguous ask) was written down, numbered: under `## Assumptions` when it can be undone and has a clear pick, under `## Blocked` as a question when it is hard to undo, outward-facing or a close call, each with `- (a)` choices and the one taken marked `(chosen)`. Where it is written depends on who made it. A task agent writes in its task's ARBOR.md. A lane or untriaged orchestrator has no task of its own but a todo it does itself, graded by that task's ARBOR.md, so grade its other calls (lane names, model picks, answers from the lane) by any `- Assumed ...` line in its reports (`- Assumed: ...`, `- Assumed for <task>: ...` for an answer it gave a task from the lane; it has no numbers), and the tasks it handed out by their own ARBOR.md. Count a wording as a call only when it is a name, or text the todo or user asked for; a user-facing error or log string the agent wrote while doing the work is not one. Fail when a call was made silently, or a question went only to chat in a task that was then removed with ARBOR.md left blank. Answer n/a, never fail, when no task was added and the agent only claimed, checkpointed or added a todo, or when the request left no call open",
];

/** Sections every scenario leans on, beyond its own. */
export const CORE = ["Using arbor", "Directives", "Workflow", "Reporting"];
