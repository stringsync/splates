/** A run's outcome, as the harness graded it, or `pending` for a cell yet to land and `unreadable` for a result that cannot be read. */
export type EvalStatus = "pass" | "fail" | "error" | "pending" | "unreadable";

/** An agent a batch ran on, with the skill it ran: its model and thinking level, and the skill's revision when it was not the checkout's. */
export interface EvalTarget {
	/** `<agent>/<model>@<effort>`, then ` @<revision>` for a baseline skill, what a cell names it by. */
	key: string;
	agent: string;
	model: string | null;
	/** The thinking level it ran at; null for the agent's default. */
	effort: string | null;
	/** The skill revision it ran, for a baseline, or a framework's `variant`; null for the checkout's skill or no variant. */
	skill: string | null;
}

/** One run of a project's evals: a `splates dev eval run`, or any framework's batch. */
export interface EvalBatch {
	/** Its directory under the results directory. */
	id: string;
	/** The skill it ran, or a framework batch's title, when it says. */
	skill: string | null;
	/** Who wrote it: `splates` for `splates dev eval run`, else its framework when it says. */
	producer: string | null;
	/** When it started, as ISO 8601. */
	startedAt: string;
	targets: EvalTarget[];
	/** How many cells ended each way, `pending` among them. */
	tally: Partial<Record<EvalStatus, number>>;
	cells: number;
	/** Summed over its runs; null when none could say. */
	tokens: number | null;
	costUsd: number | null;
}

/** One saved run, as a cell shows it. */
export interface EvalRun {
	/** `<batch>#<cell>`: its batch's directory under the results directory, and its cell. */
	id: string;
	status: EvalStatus;
	tokens: number | null;
	costUsd: number | null;
	milliseconds: number;
	/** What broke, for `error`, or why it is `unreadable`. */
	error?: string;
	/** From 0 to 1, when its framework grades on a scale. */
	score?: number;
	/** Why it ended as it did, in its framework's words. */
	reason?: string;
	/** Its framework's own view of it. */
	url?: string;
}

/** One cell of a batch's grid: a scenario (`scenario`, as run cards name it) on a target at a repetition. */
export interface EvalCell {
	scenario: string;
	aspect: string;
	requirement: string;
	target: string;
	repetition: number;
	/** Null while it has yet to land. */
	run: EvalRun | null;
}

/** A batch with every cell, planned or landed: what the report card draws. */
export interface EvalGrid extends EvalBatch {
	grid: EvalCell[];
}

/** One code check of a run and how it went. */
export interface EvalCheck {
	id: string;
	/** What it checks, in words. */
	about: string;
	pass: boolean;
	/** Why it could not be told, when the check itself broke. */
	error?: string;
}

/** What the judge decided of a run, and why. */
export interface EvalVerdict {
	pass: boolean;
	reason: string;
}

/** One step of what the agent did: something it said, or a tool it called and what came back. */
export type EvalStep =
	| { kind: "text"; text: string }
	| { kind: "tool"; name: string; input: string; output: string | null };

/** A run opened: what it asked, each check, the judge's verdict and what the agent did. */
export interface EvalDetail extends EvalRun {
	/** Who wrote its batch, as `EvalBatch.producer`. */
	producer: string | null;
	scenario: string;
	aspect: string;
	requirement: string;
	target: EvalTarget;
	repetition: number;
	/** The person's message to the agent. */
	input: string;
	/** What the judge was asked to decide; null when the scenario has no judge. */
	rubric: string | null;
	checks: EvalCheck[];
	judge: EvalVerdict | null;
	/** The agent's reply, as written; empty when it gave none. */
	reply: string;
	transcript: EvalStep[];
}
