import type {
	EvalAgentsView,
	EvalBatch,
	EvalBudgetView,
	EvalDetail,
	EvalGrid,
	EvalLaunch,
	EvalPlan,
	EvalScenario,
	EvalScenarioState,
} from "@splates/server/evals/browser";
import { ApiError, answered, scoped, sendJson } from "./request";

/**
 * Every saved eval batch of the project this page shows, newest first; null
 * when it has none to read: it names no `evals.results`.
 */
export async function evalBatches(): Promise<EvalBatch[] | null> {
	const response = await answered(scoped("/api/evals"));
	if (!response.ok) {
		throw new ApiError("error", `/api/evals: ${response.status}`);
	}
	return (await response.json()) as EvalBatch[] | null;
}

/** The batch `id` names, with every cell, planned or landed. */
export async function evalBatch(id: string): Promise<EvalGrid> {
	const response = await answered(
		scoped(`/api/evals/batch?id=${encodeURIComponent(id)}`),
	);
	if (!response.ok) {
		throw new ApiError("error", `/api/evals/batch: ${response.status}`);
	}
	return (await response.json()) as EvalGrid;
}

/** The run `id` names, opened with its checks and the evidence they read. */
export async function evalRun(id: string): Promise<EvalDetail> {
	const response = await answered(
		scoped(`/api/evals/run?id=${encodeURIComponent(id)}`),
	);
	if (!response.ok) {
		throw new ApiError("error", `/api/evals/run: ${response.status}`);
	}
	return (await response.json()) as EvalDetail;
}

/** The agents evals run on, and what a pick of them can name. */
export async function evalAgents(): Promise<EvalAgentsView> {
	const response = await answered("/api/evals/agents");
	if (!response.ok) {
		throw new ApiError("error", `/api/evals/agents: ${response.status}`);
	}
	return (await response.json()) as EvalAgentsView;
}

/** Saves the agents evals run on, throwing the server's refusal when they do not check out. */
export async function saveEvalAgents(
	agents: EvalAgentsView["agents"],
): Promise<EvalAgentsView> {
	return (await sendJson("/api/evals/agents", "PUT", {
		agents,
	})) as EvalAgentsView;
}

/** `conversation`'s eval budget: what its person approved, what its rounds spent, and its cards' answers. */
export async function evalBudget(
	conversation: string,
): Promise<EvalBudgetView> {
	const path = `/api/evals/budget?conversation=${encodeURIComponent(conversation)}`;
	const response = await answered(path);
	if (!response.ok) {
		throw new ApiError("error", `/api/evals/budget: ${response.status}`);
	}
	const read = (await response.json()) as Partial<EvalBudgetView> | null;
	if (typeof read?.usd !== "number" || typeof read.spent !== "number") {
		throw new ApiError("error", "/api/evals/budget: not a budget");
	}
	return {
		usd: read.usd,
		spent: read.spent,
		answers: read.answers ?? {},
		...(read.seeded === undefined ? {} : { seeded: read.seeded }),
	};
}

/**
 * Answers `conversation`'s eval budget card `card`: adds `usd` dollars to its
 * budget, or declines with null. Answers the budget as it now stands.
 */
export async function answerEvalBudget(
	conversation: string,
	card: string,
	usd: number | null,
): Promise<EvalBudgetView> {
	return (await sendJson("/api/evals/budget", "POST", {
		conversation,
		card,
		usd,
	})) as EvalBudgetView;
}

/** What a run of `scenarios` on `agents` would reserve, from the runner's free plan. */
export async function evalPlan(run: EvalRunAsk): Promise<EvalPlan> {
	return (await sendJson(scoped("/api/evals/plan"), "POST", run)) as EvalPlan;
}

/**
 * Every case the project's `evals.list` prints, from the worktree of
 * `conversation` when it has one.
 */
export async function evalScenarios(
	conversation: string | null = null,
): Promise<EvalScenario[]> {
	const response = await answered(
		scoped(
			conversation === null
				? "/api/evals/scenarios"
				: `/api/evals/scenarios?conversation=${encodeURIComponent(conversation)}`,
		),
	);
	if (!response.ok) {
		throw new ApiError("error", `/api/evals/scenarios: ${response.status}`);
	}
	return (await response.json()) as EvalScenario[];
}

/** Where each listed scenario stands (failing, never run or passing), from the saved batches. */
export async function evalStates(): Promise<EvalScenarioState[]> {
	const response = await answered(scoped("/api/evals/states"));
	if (!response.ok) {
		throw new ApiError("error", `/api/evals/states: ${response.status}`);
	}
	return (await response.json()) as EvalScenarioState[];
}

/** The run of card `key`; null when this server has none for it. */
export async function evalLaunch(key: string): Promise<EvalLaunch | null> {
	const response = await answered(
		scoped(`/api/evals/launch?key=${encodeURIComponent(key)}`),
	);
	if (!response.ok) {
		throw new ApiError("error", `/api/evals/launch: ${response.status}`);
	}
	const read = (await response.json()) as Partial<EvalLaunch> | null;
	return read !== null && typeof read.status === "string"
		? (read as EvalLaunch)
		: null;
}

/** The run writing `batch`, so its report can follow and stop it; null when none here does. */
export async function evalLaunchOfBatch(
	batch: string,
): Promise<EvalLaunch | null> {
	const response = await answered(
		scoped(`/api/evals/launch?batch=${encodeURIComponent(batch)}`),
	);
	if (!response.ok) {
		throw new ApiError("error", `/api/evals/launch: ${response.status}`);
	}
	return (await response.json()) as EvalLaunch | null;
}

/** Stops the run of card `key`. */
export async function stopEvalRun(key: string): Promise<void> {
	await sendJson(
		scoped(`/api/evals/launch?key=${encodeURIComponent(key)}`),
		"DELETE",
		{},
	);
}

/** What a run is asked with: the cases, the agents and what the change is judged against. */
export interface EvalRunAsk {
	skill: string;
	scenarios: string[];
	agents: EvalAgentsView["agents"];
	baseline: string | null;
	/** Runs of each cell; the runner's default when absent. */
	reps?: number;
	/** The conversation whose card asks, told once the run is done, and whose worktree it runs in. */
	conversation?: string | null;
}
