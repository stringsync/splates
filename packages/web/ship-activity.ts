import type { Cascade, CascadeStep, Ship, Stage } from "@splates/server/ship";
import { shipName } from "@splates/server/ship/browser";

/**
 * What the ship under way asks of the page: `waiting` while it needs the
 * person (a bump task's questions), `error` once its cascade stopped and so waits on the person to retry or abandon it, `running` while it goes on its own, null while none runs.
 */
export type ShipActivity = "error" | "waiting" | "running" | null;

/** Whether the cascade under way, with its ship, waits on the person. */
export function needsYou(cascade: Cascade): boolean {
	return cascade.steps.some(
		(step) =>
			step.status === "asking" ||
			step.status === "stopped" ||
			step.status === "failed",
	);
}

export function shipActivity(
	reading: { cascade: Cascade | null; ship: Ship | null } | null | undefined,
): ShipActivity {
	const { cascade, ship } = reading ?? { cascade: null, ship: null };
	if (cascade?.status === "stopped") {
		return "error";
	}
	if (cascade === null || cascade.status !== "running") {
		return ship?.status === "running" ? "running" : null;
	}
	return needsYou(cascade) ? "waiting" : "running";
}

/** The step of `step` past its deadline, or null while none is. */
export function hungIn(step: CascadeStep): Stage | null {
	return step.stages.find((stage) => stage.state === "hung") ?? null;
}

/**
 * One line on where the ship cascade stands, for a card that follows it:
 * "wren publishing", "waiting on your 2FA", "splates hung at build";
 * null before it first speaks.
 */
export function shipLine(
	reading: { cascade: Cascade | null; ship: Ship | null } | null | undefined,
): string | null {
	const { cascade } = reading ?? { cascade: null, ship: null };
	if (cascade === null) {
		return null;
	}
	if (cascade.status === "done") {
		return `${shipName(cascade.from)} shipped`;
	}
	if (cascade.status === "abandoned") {
		return `${shipName(cascade.from)} ship abandoned`;
	}
	for (const step of cascade.steps) {
		const hung = hungIn(step);
		if (hung !== null) {
			return `${step.slug} hung at ${hung.name}`;
		}
		if (step.status === "failed" || step.status === "stopped") {
			return `${step.slug} ${step.status}`;
		}
		if (step.status === "registry") {
			return `${step.slug} waits for npm`;
		}
		if (step.status === "asking") {
			return `${step.slug}'s bump task asks you`;
		}
	}
	const going = cascade.steps.find((step) =>
		["shipping", "bumping"].includes(step.status),
	);
	return going === undefined
		? "starting"
		: `${going.slug} ${going.status === "shipping" ? "publishing" : "taking its bump"}`;
}
