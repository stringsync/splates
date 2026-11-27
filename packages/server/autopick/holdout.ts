import { createHash } from "node:crypto";
import { effortSettings, modelOption } from "../models";
import { DEFAULT_HOLDOUT, depthLabel } from "./cells";
import {
	type AutopickDecision,
	type DecideContext,
	decideEasier,
	headline,
} from "./decide";
import { higher } from "./rank";

/** Compare this version with a saved assignment's version to identify its sample. */
export const HOLDOUT_VERSION = "holdout-1";

/** A task Autopick started one difficulty easier than judged, as an experiment. */
export interface HeldOut {
	/** The assignment's {@link HOLDOUT_VERSION}. */
	version: string;
	/** The lineup the task's cell routes to, whose pick it was held back from. */
	lineup: string | null;
	/** The pick the cell would have started, in words: `Opus 5.5, high effort`. */
	from: string;
	/**
	 * Each setting, by id, that moves the conversation back up to that pick,
	 * for the Undo on its line: the model and thinking level the agent offers.
	 */
	undo: Record<string, string>;
}

/**
 * Whether the task belongs to the holdout sample. Assignment is stable
 * for the same task number, sample version, and share between 0 and 1.
 */
export function assigned(
	task: number,
	share: number,
	version = HOLDOUT_VERSION,
): boolean {
	// Bump HOLDOUT_VERSION to draw a fresh sample.
	// Read the first 32 bits of the hash as a fraction in [0, 1).
	const digest = createHash("sha256").update(`${version}:${task}`).digest();
	return digest.readUInt32BE(0) / 2 ** 32 < share;
}

/**
 * `decision` for task `task`, held back one difficulty when the holdout is
 * on and the task falls in its share: the pick of the lineup its kind routes
 * to one depth easier, on the same agent, when that is below the cell's own
 * pick. Otherwise `decision` as it was: a task judged shallow or unsure,
 * or whose easier lineup picks the same or another agent, is not held out,
 * so a lift or an Undo can always move it back up.
 */
export function holdBack(
	decision: AutopickDecision,
	context: DecideContext,
	task: number,
): AutopickDecision {
	const holdout = context.rules.holdout ?? DEFAULT_HOLDOUT;
	if (!holdout.on || !assigned(task, holdout.share)) {
		return decision;
	}
	const { agent } = decision.pick;
	const easier = decideEasier(
		{ ...context, runnable: context.runnable.filter((id) => id === agent) },
		decision,
		"held out",
	);
	if (
		easier === null ||
		easier.lineup === decision.lineup ||
		easier.pick.agent !== agent ||
		!context.rules.lineups.some(
			(each) =>
				each.id === easier.lineup &&
				each.picks.some((pick) => pick.agent === agent),
		) ||
		!higher(
			context.agents,
			{
				lineup: easier.lineup ?? null,
				kind: easier.kind,
				depth: easier.depth,
				agent,
				model: easier.pick.model ?? null,
				effort: easier.pick.effort ?? null,
			},
			decision.pick,
		)
	) {
		return decision;
	}
	const named = context.agents.find((each) => each.id === agent);
	const from = named === undefined ? agent : headline(decision.pick, named);
	// Its other agents were left out on purpose, so their passing over says nothing.
	const [picked = from, , ...why] = easier.reasons.filter(
		(each) => !each.endsWith(": can't run here"),
	);
	const route = why.find((each) => each.startsWith("route: "));
	const kept = decision.reasons
		.slice(1)
		.map((each) =>
			route !== undefined && each.startsWith("route: ") ? route : each,
		);
	return {
		...easier,
		kind: decision.kind,
		depth: decision.depth,
		reasons: [
			picked,
			`held out: started as ${depthLabel(easier.depth).toLowerCase()}, one difficulty easier, as an experiment; the cell picks ${from}`,
			...kept,
			...why.filter((each) => each !== route && !kept.includes(each)),
		],
		holdout: {
			version: HOLDOUT_VERSION,
			lineup: decision.lineup ?? null,
			from,
			undo: undoTo(decision, context),
		},
	};
}

/** The settings, by id, that put a session of the agent on `decision`'s pick. */
function undoTo(
	decision: AutopickDecision,
	context: DecideContext,
): Record<string, string> {
	const { pick } = decision;
	const offered = context.offered[pick.agent] ?? [];
	const model =
		pick.model === undefined ? null : modelOption(offered, pick.model);
	return {
		...(model === null ? {} : { [model.setting]: model.value }),
		...effortSettings(pick.effort, offered),
	};
}
