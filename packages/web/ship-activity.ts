import type { Cascade, Ship } from "@stringsync/splates-server/ship";

/**
 * What the ship under way asks of the page: `waiting` while it needs the
 * person (npm's sign-in or code, a bump task's questions, a project stopped
 * or failed), `running` while it goes on its own, null while none runs.
 */
export type ShipActivity = "waiting" | "running" | null;

/** Whether the cascade under way, with its ship, waits on the person. */
export function needsYou(cascade: Cascade, ship: Ship | null): boolean {
	return (
		ship?.waiting != null ||
		cascade.steps.some(
			(step) =>
				step.status === "asking" ||
				step.status === "stopped" ||
				step.status === "failed",
		)
	);
}

export function shipActivity(
	reading: { cascade: Cascade | null; ship: Ship | null } | null | undefined,
): ShipActivity {
	const { cascade, ship } = reading ?? { cascade: null, ship: null };
	if (cascade === null || cascade.status !== "running") {
		return ship?.status === "running"
			? ship.waiting === null
				? "running"
				: "waiting"
			: null;
	}
	return needsYou(cascade, ship) ? "waiting" : "running";
}
