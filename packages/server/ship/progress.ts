import type { BumpState } from "./bumps";
import type { Cascade, CascadeStep } from "./cascade";
import { cascadeId, type ShipHistory } from "./history";
import type { ShipPlan } from "./plan";
import { SHIP_STAGES, type Ship } from "./run";
import {
	begun,
	deadlineOf,
	ended,
	pendingStage,
	STAGE_ENDED,
	type Stage,
	type StageKey,
	shownStage,
} from "./stages";

/** The steps a bump task takes. */
export const BUMP_STAGES: StageKey[] = ["bump", "gate", "merged"];

/** The steps a ship takes, checked against its plan at the end. */
export const PUBLISH_STAGES: StageKey[] = [...SHIP_STAGES, "versions"];

/**
 * The cascade of `plan`, started at `started`, each project's steps not
 * begun, each expected to take what `history` says it took lately.
 */
export async function planned(
	plan: ShipPlan,
	started: string,
	history: ShipHistory,
): Promise<Cascade> {
	const kept = await history.list();
	return {
		id: cascadeId(plan.from, started),
		from: plan.from,
		...(plan.recovery === undefined ? {} : { recovery: plan.recovery }),
		status: "running",
		started,
		ended: null,
		steps: await Promise.all(
			plan.steps.map(async (step) => ({
				...step,
				status: "waiting" as const,
				task: null,
				ship: null,
				published: [],
				note: null,
				stages: await Promise.all(
					[
						...(step.takes.length === 0 ? [] : BUMP_STAGES),
						...(step.action === "ship" ? PUBLISH_STAGES : []),
					].map(async (key) =>
						pendingStage(key, await history.expected(step.slug, key, kept)),
					),
				),
			})),
		),
	};
}

/**
 * Moves `step`'s bump steps on to what its bump task's `state` says at
 * `at`: the agent's work running or asking the person, the merge gate being
 * checked, or all three done once it merged. A removed task ends whatever
 * had not ended.
 */
export function bumpRead(
	step: CascadeStep,
	state: BumpState,
	at: string,
	task = `task ${step.task}`,
): void {
	const check = { at, result: `${task} is ${state}` };
	switch (state) {
		case "open":
		case "asking":
			setStage(step, "bump", (stage) => ({
				...begun(stage, at, state === "open" ? "running" : "asking"),
				check,
			}));
			return;
		case "gating":
			setStage(step, "bump", (stage) =>
				stage.ended === null ? ended(stage, at, "done") : stage,
			);
			setStage(step, "gate", (stage) => ({
				...begun(stage, at, "checking"),
				check,
			}));
			return;
		case "removed":
			closeOut(step, at);
			return;
		case "merged":
			for (const key of BUMP_STAGES) {
				setStage(step, key, (stage) =>
					stage.ended === null ? { ...ended(stage, at, "done"), check } : stage,
				);
			}
	}
}

/** `step`'s bump task `task`, added and queued at `at`, begun. */
export function bumpAdded(
	step: CascadeStep,
	at: string,
	result = `added and queued task ${step.task}`,
): void {
	setStage(step, "bump", (stage) => ({
		...begun(stage, at),
		check: { at, result },
	}));
}

/**
 * Moves `step`'s publish steps on to what `ship` last wrote, and, once it
 * ended, checks what it published: `failed` with why when not as planned.
 */
export function publishRead(
	step: CascadeStep,
	ship: Ship,
	at: string,
	failed: string | null,
): void {
	step.stages = withShip(step.stages, ship);
	if (ship.status === "failed") {
		setStage(step, "versions", (stage) => ({
			...stage,
			state: "skipped",
			ended: at,
		}));
	} else if (ship.status === "done") {
		setStage(step, "versions", (stage) => ({
			...ended(stage, at, failed === null ? "done" : "failed"),
			check: {
				at,
				result:
					failed ??
					(step.to === null
						? `published ${ship.to ?? "its next version"}`
						: `published ${step.to}, as planned`),
			},
		}));
	}
}

/** `step`'s ship would not start at `at`, for `why`. */
export function shipRefused(step: CascadeStep, at: string, why: string): void {
	setStage(step, "login", (stage) => ({
		...ended(stage, at, "failed"),
		check: { at, result: why },
	}));
}

/** Ends `step`'s steps that never ended at `at`: those under way failed, the rest skipped. */
export function closeOut(step: CascadeStep, at: string): void {
	step.stages = step.stages.map((stage) =>
		STAGE_ENDED.includes(stage.state)
			? stage
			: stage.started === null
				? { ...stage, state: "skipped", ended: at }
				: ended(stage, at, "failed"),
	);
}

/**
 * `cascade` as the page shows it at `now`: the project publishing with its
 * ship's own steps as `ship` last wrote them, and any step under way past
 * its deadline hung.
 */
export function shownCascade(
	cascade: Cascade,
	ship: Ship | null,
	now: number,
): Cascade {
	return {
		...cascade,
		steps: cascade.steps.map((step) => ({
			...step,
			stages: (step.status === "shipping" && ship !== null
				? withShip(step.stages, ship)
				: step.stages
			).map((stage) => shownStage(stage, now)),
		})),
	};
}

/** `cascade` as this server keeps one, whatever server kept it. */
export function upgraded(cascade: Cascade): Cascade {
	return {
		...cascade,
		id: cascade.id ?? cascadeId(cascade.from, cascade.started),
		steps: cascade.steps.map((step) => ({
			...step,
			stages: step.stages ?? [],
		})),
	};
}

/** Changes `step`'s step `key`, when it has one. */
function setStage(
	step: CascadeStep,
	key: StageKey,
	change: (stage: Stage) => Stage,
): void {
	step.stages = step.stages.map((stage) =>
		stage.key === key ? change(stage) : stage,
	);
}

/**
 * `stages` with the ship's own steps as `ship` last wrote them, keeping the
 * expected time each was given from ships before, and its deadline from it.
 */
function withShip(stages: Stage[], ship: Ship): Stage[] {
	return stages.map((stage) => {
		const live = ship.stages?.find((each) => each.key === stage.key);
		if (live === undefined) {
			return stage;
		}
		const kept = { ...live, expected: stage.expected, known: stage.known };
		return {
			...kept,
			deadline: live.started === null ? null : deadlineOf(kept, live.started),
		};
	});
}
