/** What a `batch.json` in the public format says it is. */
export const CONTRACT_FORMAT = "splates-evals/1";

/** The file each finished cell appends its line to, in its batch's directory. */
export const RESULTS_FILE = "results.jsonl";

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

/**
 * `batch.json` as any framework writes it (`designs/evals-contract.md`):
 * every cell it plans, before any runs.
 */
export interface ContractBatch {
	format: typeof CONTRACT_FORMAT;
	/** As ISO 8601. */
	startedAt: string;
	title?: string;
	/** Who wrote the batch; `splates` for splates's own harness, which the page gives its skill controls. */
	producer?: string;
	/** Which skill and scenarios the batch ran, to compare pass rates only between batches that ran the same scenarios. */
	revision?: ContractRevision;
	cells: ContractCell[];
}

/** The skill and scenarios a batch ran. */
export interface ContractRevision {
	/** The git commit the skill was at, when it is in a repository. */
	commit?: string;
	/** SHA-256 of the skill as a sandbox installs it: everything but its top-level `evals/`. */
	skillHash: string;
	/** SHA-256 of the skill's `evals/` directory: the scenario files, with their checks and judge prompts. */
	scenarioHash: string;
}

/** One case on one target at one repetition. */
export interface ContractCell {
	/** Unique in its batch; what a result line names it by. */
	id: string;
	case: string;
	/** What the page groups cases under. */
	group?: string;
	/** What the case asks, in words. */
	about?: string;
	target: ContractTarget;
	repetition?: number;
	/** A hash of everything the case's verdict depends on, so a page can tell a case's latest run is stale once it changes. */
	fingerprint?: string;
}

/** Free-form labels for what a cell ran on. */
export interface ContractTarget {
	model: string;
	agent?: string;
	effort?: string;
	/** Anything else the run varied, such as a prompt's revision. */
	variant?: string;
}

/** A line of `results.jsonl`: how one cell ended. */
export interface ContractResult {
	cell: string;
	status: "pass" | "fail" | "error";
	/** From 0 to 1, for a framework that grades on a scale. */
	score?: number;
	reason?: string;
	tokens?: number;
	costUsd?: number;
	milliseconds?: number;
	/** The framework's own view of the cell. */
	url?: string;
	/** A JSON file in the batch's directory with what the cell did, `ContractDetail`. */
	detail?: string;
}

/** What a result's `detail` file holds, every field optional. */
export interface ContractDetail {
	input?: string;
	rubric?: string;
	reply?: string;
	checks?: EvalCheck[];
	judge?: EvalVerdict;
	transcript?: EvalStep[];
	/** Files in the batch's directory holding the run's repo as it ended: a git bundle, and the uncommitted work as a patch when there was any. */
	repo?: { bundle: string; diff?: string };
}
