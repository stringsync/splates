import type {
	Cascade,
	CascadeSummary,
	Ship,
	ShipBump,
	ShipGraph,
	ShipPlan,
	StageKey,
} from "@stringsync/splates-server/ship";
import { ApiError, answered, scoped, send } from "./request";

/**
 * Starts a ship of `project` at `bump`, the page's own for "", on the server,
 * under the person's own npm sign-in: what the shared plan's Approve does.
 */
export async function startShip(
	project: string,
	bump: ShipBump = "patch",
): Promise<void> {
	const query = new URLSearchParams(
		project === "" ? { bump } : { project, bump },
	);
	await send(`/api/ship?${query}`, {});
}

/**
 * The plan to ship `project` at `bump`: it, then each project downstream in
 * dependency order, what Approve starts; throws the server's refusal, as for
 * a project that names no ship command.
 */
export async function shipPlan(
	project: string,
	bump: ShipBump = "patch",
): Promise<ShipPlan> {
	const response = await answered(
		`/api/ship/plan?${new URLSearchParams({ project, bump })}`,
	);
	const body = (await response.json().catch(() => ({}))) as
		| ShipPlan
		| { reason?: string; message?: string };
	if (!response.ok || !("steps" in body)) {
		const refused = body as { reason?: string; message?: string };
		throw new ApiError(
			refused.reason ?? "error",
			refused.message ?? `/api/ship/plan: ${response.status}`,
		);
	}
	return body;
}

/** Every registered project and who pins whose packages, the Ship page's tree. */
export async function shipGraph(): Promise<ShipGraph> {
	const response = await answered("/api/ship/graph");
	if (!response.ok) {
		throw new ApiError("error", `/api/ship/graph: ${response.status}`);
	}
	return (await response.json()) as ShipGraph;
}

/** Changes a pending publish in the cascade under way to `bump`. */
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
