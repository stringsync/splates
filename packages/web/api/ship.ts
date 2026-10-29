import type {
	Cascade,
	CascadeSummary,
	Ship,
	ShipBump,
	ShipGraph,
	StageKey,
} from "@stringsync/splates-server/ship";
import { ApiError, answered, scoped, send, sendJson } from "./request";

/**
 * Starts planning a ship of `projects` on the server, none to replan the
 * stopped run from what it published; the id of the run its conversation
 * is told to drive. Throws the server's refusal, such as a ship under way.
 */
export async function startShipRun(projects: string[]): Promise<string> {
	const run = (await sendJson("/api/ship/run", "POST", { projects })) as {
		run: { id: string };
	};
	return run.run.id;
}

/** Every registered project and who pins whose packages, the Ship page's tree. */
export async function shipGraph(): Promise<ShipGraph> {
	const response = await answered("/api/ship/graph");
	if (!response.ok) {
		throw new ApiError("error", `/api/ship/graph: ${response.status}`);
	}
	return (await response.json()) as ShipGraph;
}

/** Requests a release-type revision; the server refuses changes during a run. */
export async function reviseCascadeBump(
	project: string,
	bump: ShipBump,
): Promise<void> {
	await send(`/api/ship/cascade?${new URLSearchParams({ project, bump })}`, {
		method: "PATCH",
	});
}

/** Ends the ship cascade under way, stopping its ship and removing its open bump tasks. */
export async function abandonCascade(): Promise<void> {
	await send("/api/ship/cascade/abandon", {});
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
