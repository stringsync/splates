import type { ShipBump, ShipPlan } from "@stringsync/splates-server/ship";
import { ApiError, answered, send } from "./request";

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

/** Changes a pending publish in the cascade under way to `bump`. */
export async function reviseCascadeBump(
	project: string,
	bump: ShipBump,
): Promise<void> {
	await send(`/api/ship/cascade?${new URLSearchParams({ project, bump })}`, {
		method: "PATCH",
	});
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
