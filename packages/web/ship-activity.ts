import type {
	Cascade,
	CascadeStep,
	Ship,
	Stage,
} from "@stringsync/splates-server/ship";

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

/** The step of `step` past its deadline, or null while none is. */
export function hungIn(step: CascadeStep): Stage | null {
	return step.stages.find((stage) => stage.state === "hung") ?? null;
}

/**
 * One line on where the ship cascade stands, for a card that follows it:
 * "webappwiz publishing", "waiting on your 2FA", "splates hung at build";
 * null before it first speaks.
 */
export function shipLine(
	reading: { cascade: Cascade | null; ship: Ship | null } | null | undefined,
): string | null {
	const { cascade, ship } = reading ?? { cascade: null, ship: null };
	if (cascade === null) {
		return null;
	}
	if (cascade.status === "done") {
		return `${cascade.from} shipped`;
	}
	if (cascade.status === "abandoned") {
		return `${cascade.from} ship abandoned`;
	}
	if (ship?.waiting != null) {
		return ship.waiting.kind === "login"
			? "waiting on your npm sign-in"
			: "waiting on your 2FA";
	}
	for (const step of cascade.steps) {
		const hung = hungIn(step);
		if (hung !== null) {
			return `${step.slug} hung at ${hung.name}`;
		}
		if (step.status === "failed" || step.status === "stopped") {
			return `${step.slug} ${step.status}${step.fix === null ? "" : ", an agent is on it"}`;
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
