import type {
	SetupProgress,
	StepAnswers,
	UndoPlan,
} from "@stringsync/splates-server/setup";
import { Duration } from "webappwiz/time";
import { ApiError, answered, scoped, sendJson } from "./api";

/** How long a step's Next may take: it may install a tool, which the server gives ten minutes. */
export const SETUP_WORK = Duration.mins(11);

/** This machine's setup: every step checked, by area, and the one to do next. */
export async function setup(): Promise<SetupProgress> {
	const response = await answered(scoped("/api/setup"));
	if (!response.ok) {
		throw new ApiError("error", `/api/setup: ${response.status}`);
	}
	return (await response.json()) as SetupProgress;
}

/**
 * Presses Next on setup step `step` with what its page answered, answering
 * the fresh progress once the step reads done; an `ApiError` whose message
 * is one line on what went wrong otherwise.
 */
export async function nextSetupStep(
	step: string,
	answers: StepAnswers,
): Promise<SetupProgress> {
	return (await sendJson(
		`/api/setup/${encodeURIComponent(step)}/next`,
		"POST",
		{ answers },
		SETUP_WORK,
	)) as SetupProgress;
}

/** What undoing setup area `area` would remove and leave, for its dialog to ask. */
export async function setupUndoPlan(area: string): Promise<UndoPlan> {
	const path = `/api/setup/${encodeURIComponent(area)}/undo`;
	const response = await answered(scoped(path));
	if (!response.ok) {
		throw new ApiError("error", `${path}: ${response.status}`);
	}
	return (await response.json()) as UndoPlan;
}

/**
 * Undoes setup area `area`, `confirm` the name its plan asks typed,
 * answering the fresh progress; an `ApiError` whose message is one line on
 * why not otherwise.
 */
export async function undoSetup(
	area: string,
	confirm: string | null,
): Promise<SetupProgress> {
	return (await sendJson(
		`/api/setup/${encodeURIComponent(area)}/undo`,
		"POST",
		{ confirm },
		SETUP_WORK,
	)) as SetupProgress;
}

/** Marks setup seen on this machine, so the page stops nudging towards it. */
export async function seeSetup(): Promise<SetupProgress> {
	return (await sendJson("/api/setup/seen", "PUT", {})) as SetupProgress;
}
