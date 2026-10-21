/** A run's outcome, as the harness grades it, or `pending` for a cell yet to land and `unreadable` for a result the harness refuses. */
export type EvalStatus =
	| "pass"
	| "fail"
	| "uncovered"
	| "bound"
	| "infrastructure-error"
	| "unsupported"
	| "pending"
	| "unreadable";

/** An agent a batch ran on: its adapter, as `claude@1`, and model. */
export interface EvalTarget {
	/** `<adapterVersion>/<model>`, what a cell names it by. */
	key: string;
	agent: string;
	model: string | null;
}

/** One `splates dev eval` invocation, or the runs saved loose on one day before batches. */
export interface EvalBatch {
	/** Its directory under the results directory, or `loose-<YYYY-MM-DD>`. */
	id: string;
	kind: "batch" | "paired" | "unchanged-baseline" | "loose";
	/** The skill it ran, when it says. */
	skill: string | null;
	/** When it started, as ISO 8601. */
	startedAt: string;
	targets: EvalTarget[];
	/** How many cells ended each way, `pending` among them. */
	tally: Partial<Record<EvalStatus, number>>;
	cells: number;
	/** Summed over its runs; null when any could not say. */
	tokens: number | null;
	costUsd: number | null;
}

/** One saved run, as a cell shows it. */
export interface EvalRun {
	/** Its `result.json`, relative to the results directory. */
	id: string;
	status: EvalStatus;
	tokens: number | null;
	costUsd: number | null;
	milliseconds: number;
	/** Why the harness refused it, for `unreadable`. */
	error?: string;
}

/** One cell of a batch's grid: a probe on a target at a repetition. */
export interface EvalCell {
	probe: string;
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

/** An event the run saw: a command, read, write or directive. */
export interface EvalEvent {
	id: string;
	actor: string;
	kind: string;
	name: string;
	args: string[];
	exitCode?: number;
	payload?: unknown;
}

/**
 * One check of a run and how it went. `assertion` is the probe's own spec of
 * it, by kind: `count`, `before`, `state`, `reply` and `uncovered`; `runner`
 * for the harness's own, a channel the run left incomplete.
 */
export interface EvalCheck {
	id: string;
	status: "pass" | "fail" | "uncovered";
	assertion: { kind: string; [key: string]: unknown };
	expected: unknown;
	actual: unknown;
	/** The events it rests on, by id. */
	evidence: string[];
}

/** A run opened: what it asked, each check and everything the checks read. */
export interface EvalDetail extends EvalRun {
	probe: string;
	aspect: string;
	requirement: string;
	requirementText: string;
	target: EvalTarget;
	repetition: number;
	input: string;
	/** How the run stopped: `stop` at its boundary, or a bound or failure. */
	termination: string;
	detail: string | null;
	checks: EvalCheck[];
	events: EvalEvent[];
	state: Record<string, unknown>;
	/** The agent's reply, as written; null when the run has none. */
	reply: string | null;
	/** The channels the run saw whole. */
	complete: string[];
	/** Where its trace and logs are on this machine. */
	logs: string;
	/** The command that runs it again. */
	reproduction: string[];
}
