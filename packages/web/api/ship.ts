import type { ShipPlan } from "@stringsync/splates-server/ship";
import { ApiError, answered, send } from "./request";

/**
 * Starts a ship of `project`, the page's own for "", on the server, under
 * the person's own npm sign-in: the page's part of a ship card's Allow.
 */
export async function startShip(project: string): Promise<void> {
	await send(
		project === ""
			? "/api/ship"
			: `/api/ship?${new URLSearchParams({ project })}`,
		{},
	);
}

/**
 * The plan to ship `project`: it, then each project downstream in
 * dependency order, what Approve starts; throws the server's refusal, as for
 * a project that names no ship command.
 */
export async function shipPlan(project: string): Promise<ShipPlan> {
	const response = await answered(
		`/api/ship/plan?${new URLSearchParams({ project })}`,
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

/** Takes `project` out of the ship cascade under way, so those after it go on without it. */
export async function dropFromCascade(project: string): Promise<void> {
	await send(`/api/ship/cascade?${new URLSearchParams({ project })}`, {
		method: "DELETE",
	});
}

/** Runs `project` again where it failed or stopped in the ship cascade under way. */
export async function retryInCascade(project: string): Promise<void> {
	await send(`/api/ship/cascade/retry?${new URLSearchParams({ project })}`, {});
}
