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
	/** Shell run in the repository after the queued tasks are seeded. */
	setup?: string;
	/**
	 * Whether the agent runs as one `splates server` started, so `splates add
	 * --agent` hands a queued task to an agent the page would start, and `splates
	 * tell` reaches it; setup runs as that agent too.
	 */
	dev?: boolean;
	/** Headings of the skill sections it exercises, wherever they live; a change to one runs it. */
	sections: string[];
	checks: EvalCheck[];
	/** What a model grades, each `<id>: <what passes>`. */
	rubric: string[];
}

/** What a model grades in every scenario. */
export const COMMON_RUBRIC = [
	"decisions: every call the request did not settle (a name, a default, a number, one reading of an ambiguous ask) went where the skill puts it: a numbered question under `## Blocked`, with `- (a)` choices and any pick marked `(chosen)`, when undoing it reaches past the repo's code (data, users, outside systems), a wrong guess would cost much rework, or it goes against what the user said; otherwise the agent made it itself, a close call included, and wrote it in `## Notes` prose for whoever resumes the task, without putting it to the user. A task agent writes in its task's SPLATES.md. A lane or untriaged orchestrator has no task of its own, so grade the tasks it handed out by their own SPLATES.md. Count a wording as a call only when it is a name, or text the task or user asked for; a user-facing error or log string the agent wrote while doing the work is not one. Fail when a call that needed the user was made without asking, a call one commit's revert would undo was asked anyway, or a question went only to chat in a task that was then removed with SPLATES.md left blank. Answer n/a, never fail, when no task was added and the agent only claimed, checkpointed or added a queued task, or when the request left no call open",
];

/** Sections every scenario leans on, beyond its own. */
export const CORE = [
	"Using splates",
	"Directives",
	"Reference files",
	"Workflow",
	"Reporting",
];
