import type {
	WorkerBudgetReport,
	WorkerLimit,
} from "@stringsync/splates-server/workers";
import { ApiError, send, sendJson } from "./api";

/**
 * Where the worker budget stands; null when there is none, as without a
 * `workerProvider`.
 */
export async function workerBudget(): Promise<WorkerBudgetReport | null> {
	const response = await fetch("/api/worker-budget");
	const body = (await response.json().catch(() => ({}))) as
		| WorkerBudgetReport
		| { reason?: string; message?: string };
	if (response.status === 400) {
		return null;
	}
	if (!response.ok || !("standing" in body)) {
		const refused = body as { reason?: string; message?: string };
		throw new ApiError(
			refused.reason ?? "error",
			refused.message ?? `/api/worker-budget: ${response.status}`,
		);
	}
	return body;
}

/** Sets a worker budget limit to `dollars`; null gives it back to its default. */
export async function setWorkerLimit(
	limit: WorkerLimit,
	dollars: number | null,
): Promise<WorkerBudgetReport> {
	return (await sendJson(`/api/worker-budget/${limit}`, "PUT", {
		dollars,
	})) as WorkerBudgetReport;
}

/** Adds `dollars` to a worker budget limit for `span`, like `1d`. */
export async function raiseWorkerLimit(
	limit: WorkerLimit,
	dollars: number,
	span: string,
): Promise<WorkerBudgetReport> {
	return (await sendJson("/api/worker-budget/raises", "POST", {
		limit,
		dollars,
		for: span,
	})) as WorkerBudgetReport;
}

/** Ends worker budget raise `id` now. */
export async function endWorkerRaise(id: number): Promise<WorkerBudgetReport> {
	return (await send(`/api/worker-budget/raises/${id}`, {
		method: "DELETE",
	})) as WorkerBudgetReport;
}
