import type {
	EvalBatch,
	EvalDetail,
	EvalGrid,
} from "@stringsync/splates-server/evals/browser";
import { ApiError } from "./request";

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
