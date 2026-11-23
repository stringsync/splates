import type { OptionValues } from "./start";
import type { RigExposure } from "./wire";

/** Where a run can start: the main tree, or a task's worktree by its name. */
export interface RunTree {
	name: string;
	path: string;
}

/** How far a run has got. A stopped run is no longer listed. */
export type RunState = "starting" | "healthy" | "unhealthy" | "exited";

/** The persistent animal slot a tunnel-exposed rig holds, as `cat` 😸. */
export interface RunSlot {
	word: string;
	emoji: string;
}

/** One port a run listens on, with where to open it. */
export interface RunPort {
	name: string;
	port: number;
	local: string;
	/** Public URL (animal tunnel host or self-reported); null when local only or not yet reported. */
	remote: string | null;
}

/** A run as the page shows it. */
export interface RunView {
	/** `<group>/<rig>@<tree>`: one run at most per rig and tree. */
	id: string;
	group: string;
	rig: string;
	label: string;
	tree: string;
	/** How splates exposes this run: through its tunnel, local only, or self-reported. */
	exposure: RigExposure;
	/** Animal slot held by a tunnel-exposed run when `--ports-host` is configured; null otherwise. */
	slot: RunSlot | null;
	values: OptionValues;
	/** The preset it started from, when the form had one picked. */
	preset: string | null;
	state: RunState;
	/** The last health check's answer, as `GET /healthz → 503`, to show why it is unhealthy; null before one. */
	health: string | null;
	exitCode: number | null;
	startedAt: number;
	endedAt: number | null;
	ports: RunPort[];
	/** The last line it logged, for a row that has no room for the log. */
	lastLine: string | null;
}

/** What starting a run asks for. */
export interface RunRequest {
	group: string;
	rig: string;
	tree: string;
	values?: OptionValues;
	preset?: string | null;
}

/** Lines of its log, numbered from 1, after the number asked for. */
export interface RunLog {
	lines: { n: number; text: string }[];
	/** The number of the last line it has logged, to ask after next time. */
	last: number;
}
