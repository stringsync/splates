import type {
	OptionValues,
	RigPresets,
	RigsPage,
	RunLog,
	RunView,
} from "@splates/server/rigs/browser";
import { Duration } from "core/time";
import { ApiError, answered, scoped } from "./request";

/** The project's rigs, their runs, the trees a run may start on, and saved presets. */
export async function rigsPage({
	fresh = false,
}: {
	/** Read every rig command again first, rather than take the last read. */
	fresh?: boolean;
} = {}): Promise<RigsPage> {
	const response = await answered(
		scoped(fresh ? "/api/rigs?fresh=1" : "/api/rigs"),
		// Describing the rigs runs each command, with half a minute to answer.
		{ within: Duration.mins(1) },
	);
	if (!response.ok) {
		throw new ApiError("error", `/api/rigs: ${response.status}`);
	}
	return (await response.json()) as RigsPage;
}

/** Starts a run of `rig` in `group` on `tree` with `values`; throws with why it was refused. */
export async function startRun(request: {
	group: string;
	rig: string;
	tree: string;
	values: OptionValues;
	preset: string | null;
}): Promise<RunView> {
	return (await sent("/api/rigs/start", "POST", request)) as RunView;
}

/** Stops run `id`, or dismisses it once it has exited. */
export async function stopRun(id: string): Promise<void> {
	await sent("/api/rigs/stop", "POST", { id });
}

/** Run `id`'s log lines after line `after`. */
export async function runLog(id: string, after: number): Promise<RunLog> {
	const query = new URLSearchParams({ id, after: String(after) });
	const response = await answered(scoped(`/api/rigs/log?${query}`));
	if (!response.ok) {
		throw new ApiError("error", `/api/rigs/log: ${response.status}`);
	}
	return (await response.json()) as RunLog;
}

/** Saves `values` as preset `name` of `group`'s `rig`, or drops it with no values. */
export async function savePreset(preset: {
	group: string;
	rig: string;
	name: string;
	values?: OptionValues;
}): Promise<RigPresets> {
	return (await sent(
		"/api/rigs/presets",
		preset.values === undefined ? "DELETE" : "PUT",
		preset,
	)) as RigPresets;
}

async function sent(
	path: string,
	method: string,
	body: unknown,
): Promise<unknown> {
	const response = await answered(scoped(path), {
		method,
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
	const answer = (await response.json().catch(() => ({}))) as {
		error?: string;
	};
	if (!response.ok) {
		throw new ApiError("error", answer.error ?? `${path}: ${response.status}`);
	}
	return answer;
}
