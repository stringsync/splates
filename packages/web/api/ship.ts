import { send } from "./request";

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
