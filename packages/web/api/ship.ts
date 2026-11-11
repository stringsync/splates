import type {
	Cascade,
	CascadeSummary,
	Ship,
	ShipGraph,
	StageKey,
} from "@splates/server/ship";
import { ApiError, answered, scoped } from "./request";

/** Every registered project and who pins whose packages, the Ship page's tree. */
export async function shipGraph(): Promise<ShipGraph> {
	const response = await answered("/api/ship/graph");
	if (!response.ok) {
		throw new ApiError("error", `/api/ship/graph: ${response.status}`);
	}
	return (await response.json()) as ShipGraph;
}

/** The cascades history keeps, newest first. */
export async function shipHistory(): Promise<CascadeSummary[]> {
	const response = await answered(scoped("/api/ship/history"));
	if (!response.ok) {
		throw new ApiError("error", `/api/ship/history: ${response.status}`);
	}
	return (await response.json()) as CascadeSummary[];
}

/** The cascade history keeps as `id`, with its steps. */
export async function shipHistoryEntry(
	id: string,
): Promise<{ cascade: Cascade; ship: Ship | null }> {
	const response = await answered(
		scoped(`/api/ship/history/${encodeURIComponent(id)}`),
	);
	if (!response.ok) {
		throw new ApiError("error", `/api/ship/history/${id}: ${response.status}`);
	}
	return (await response.json()) as { cascade: Cascade; ship: Ship | null };
}

/** Retain a successful page handoff in the ship record. */
export async function recordShipAgent(
	id: string,
	project: string,
): Promise<void> {
	const response = await answered("/api/ship/steps/agent-record", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ id, project }),
	});
	if (!response.ok) {
		throw new ApiError("error", await response.text());
	}
}

/** What step `stage` of `project`'s part in cascade `id` printed, or null for none. */
export async function shipStageLog(
	id: string,
	project: string,
	stage: StageKey,
): Promise<string | null> {
	const response = await answered(
		scoped(
			`/api/ship/history/${encodeURIComponent(id)}/log?${new URLSearchParams({ project, stage })}`,
		),
	);
	return response.ok ? await response.text() : null;
}

/** Records on the server that the person has seen ship `id`'s result. */
export async function markShipSeen(id: string): Promise<void> {
	const response = await answered("/api/ship/steps/seen", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ id }),
	});
	if (!response.ok) {
		throw new ApiError("error", await response.text());
	}
}

/** Retry the failed stage or end the ship, retaining everything already published. */
export async function actOnShip(
	action: "retry" | "abandon" | "agent",
): Promise<void> {
	const response = await answered(`/api/ship/steps/${action}`, {
		method: "POST",
	});
	if (!response.ok) {
		throw new ApiError("error", await response.text());
	}
}

/** Start the ship with the person's confirmed project choices. */
export async function startShip(selection: {
	projects: {
		slug: string;
		bump: "patch" | "minor" | "major";
		adopt: "mechanical" | "agent";
		instructions: string;
	}[];
}): Promise<void> {
	const response = await answered("/api/ship/steps", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(selection),
	});
	if (!response.ok) {
		throw new ApiError("error", await response.text());
	}
}
