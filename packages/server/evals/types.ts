import type { EvalCheck, EvalStep, EvalVerdict } from "@evals/evals/contract";
import type { Cause, Did, Remedy } from "./diagnosis";

export type { EvalCheck, EvalStep, EvalVerdict } from "@evals/evals/contract";

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
	/** Conversation that launched this batch, when known by this server. */
	conversation?: string;
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
	/** The `describe` subject the scenario's `it` sentence continues ("splates skill"), when it is written as a spec. */
	subject?: string;
	/** The spec's `it(...)` sentence, when it is written as one. */
	sentence?: string;
	target: string;
	repetition: number;
	/** What its verdict depended on when it ran, as its framework hashed it; absent when the batch says none. */
	fingerprint?: string;
	/** Null while it has yet to land. */
	run: EvalRun | null;
}

/** A batch with every cell, planned or landed: what the report card draws. */
export interface EvalGrid extends EvalBatch {
	grid: EvalCell[];
	/** An agent's or person's commentary on the batch (`remarks.md` in its directory), as Markdown; absent until it does. */
	remarks?: string;
	/** Each test's runs per target, with its failures and their diagnoses, in plan order. */
	results: EvalTestResult[];
}

/** One test's landed runs on one target, as a card's Results and Where it failed show them. */
export interface EvalTestResult {
	scenario: string;
	/** `EvalTarget.key`. */
	target: string;
	passed: number;
	/** Runs that passed or failed; errored runs are not graded and not counted. */
	graded: number;
	/** Runs the harness broke on before grading. */
	errored: number;
	/** The run to show first: the earliest failed run, else the earliest errored one; null when none did. */
	firstFailed: string | null;
	/** Its failed and errored runs, grouped by what they came down to. */
	failures: EvalFailure[];
}

/**
 * Runs of a test on a target that went wrong the same way: one entry of the
 * eval lead's diagnosis, the harness errors (known without one), or the
 * failed runs nothing diagnoses yet.
 */
export interface EvalFailure {
	/** `diagnosed` from the remarks, `harness` for errored runs none diagnoses, `undiagnosed` for failed runs none does. */
	kind: "diagnosed" | "harness" | "undiagnosed";
	/** Run ids (`EvalRun.id`), earliest repetition first. */
	runs: string[];
	/** The failed check's id, or `judge`; null unless diagnosed. */
	check: string | null;
	causes: Cause[];
	/** One sentence on why; null unless diagnosed. */
	why: string | null;
	did: Did | null;
	remedy: Remedy | null;
}

/** A run opened: what it asked, each check, the judge's verdict and what the agent did. */
export interface EvalDetail extends EvalRun {
	/** The label and size of the batch this run belongs to, when titled. */
	batch?: { title: string; cells: number };
	/** A setup failure or a skipped cell, when the producer identifies it. */
	harness?: import("@evals/evals/contract").HarnessStatus;
	/** Only the phases reached by this run, when the producer records them. */
	phases?: import("@evals/evals/contract").Phases;
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

/**
 * Where a scenario stands, from each agent's last graded runs against the
 * spec's pass rule: `failing` when an agent cannot reach a pass in its
 * window, `needs-runs` when none failed so but one has too few passes yet,
 * `never-run` with no landed run in any batch, else `passing`.
 */
export type EvalScenarioStatus =
	| "failing"
	| "needs-runs"
	| "never-run"
	| "passing";

/** One agent's runs of a scenario in its latest batch. */
export interface EvalScenarioTarget {
	/** `EvalTarget.key`. */
	target: string;
	/** Passes among its last graded runs of the spec, at most the rule's window. */
	passed: number;
	/** Those graded runs, so `2/3` is `passed` of `total`. */
	total: number;
	/** How that window stands against the spec's rule. */
	standing: "pass" | "fail" | "needs-runs";
	/** Passes the spec needs on this agent, and the window they are counted in. */
	need: number;
	of: number;
}

/** A scenario's state, as the Evals page reads it. */
export interface EvalScenarioState {
	scenario: string;
	state: EvalScenarioStatus;
	/** Per agent, from the latest batch that ran it; empty when never run. */
	targets: EvalScenarioTarget[];
	/** When the latest batch that ran it started, as ISO 8601; null when never run. */
	lastRunAt: string | null;
	/** The run to open: the first that failed in the latest batch, else its first; null when never run. */
	run: string | null;
	/** The latest batch that ran it, which its test page opens; null when never run. */
	batch?: string | null;
}
