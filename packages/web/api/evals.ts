import type {
	EvalAgentsView,
	EvalBatch,
	EvalDetail,
	EvalGrid,
	EvalLaunch,
	EvalPlan,
	EvalProbe,
} from "@stringsync/splates-server/evals/browser";
import { ApiError, sendJson } from "./request";

/**
 * Every saved eval batch, newest first; null when this server runs from a
 * release, which has no eval harness to read them with.
 */
export async function evalBatches(): Promise<EvalBatch[] | null> {
	const response = await fetch("/api/evals");
	if (response.status === 404) {
		return null;
	}
	if (!response.ok) {
		throw new ApiError("error", `/api/evals: ${response.status}`);
	}
	return (await response.json()) as EvalBatch[];
}

/** The batch `id` names, with every cell, planned or landed. */
export async function evalBatch(id: string): Promise<EvalGrid> {
	const response = await fetch(`/api/evals/batch?id=${encodeURIComponent(id)}`);
	if (!response.ok) {
		throw new ApiError("error", `/api/evals/batch: ${response.status}`);
	}
	return (await response.json()) as EvalGrid;
}

/** The run `id` names, opened with its checks and the evidence they read. */
export async function evalRun(id: string): Promise<EvalDetail> {
	const response = await fetch(`/api/evals/run?id=${encodeURIComponent(id)}`);
	if (!response.ok) {
		throw new ApiError("error", `/api/evals/run: ${response.status}`);
	}
	return (await response.json()) as EvalDetail;
}

/** The agents evals run on, and what a pick of them can name. */
export async function evalAgents(): Promise<EvalAgentsView> {
	const response = await fetch("/api/evals/agents");
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

/** What a run of `probes` on `agents` would reserve, from the runner's free plan. */
export async function evalPlan(run: EvalRunAsk): Promise<EvalPlan> {
	return (await sendJson("/api/evals/plan", "POST", run)) as EvalPlan;
}

/** Every probe the harness registers. */
export async function evalProbes(): Promise<EvalProbe[]> {
	const response = await fetch("/api/evals/probes");
	if (!response.ok) {
		throw new ApiError("error", `/api/evals/probes: ${response.status}`);
	}
	return (await response.json()) as EvalProbe[];
}

/** Starts the paid run the person asked for, the card `key` naming it. */
export async function startEvalRun(
	key: string,
	run: EvalRunAsk,
): Promise<EvalLaunch> {
	return (await sendJson("/api/evals/launch", "POST", {
		...run,
		key,
	})) as EvalLaunch;
}

/** The run of card `key`; null when this server has none for it. */
export async function evalLaunch(key: string): Promise<EvalLaunch | null> {
	const response = await fetch(
		`/api/evals/launch?key=${encodeURIComponent(key)}`,
	);
	if (!response.ok) {
		throw new ApiError("error", `/api/evals/launch: ${response.status}`);
	}
	return (await response.json()) as EvalLaunch | null;
}

/** Stops the run of card `key`. */
export async function stopEvalRun(key: string): Promise<void> {
	await sendJson(
		`/api/evals/launch?key=${encodeURIComponent(key)}`,
		"DELETE",
		{},
	);
}

/** What a run is asked with: the probes, the agents and what the skill is judged against. */
export interface EvalRunAsk {
	skill: string;
	probes: string[];
	agents: EvalAgentsView["agents"];
	baseline: string | null;
}
