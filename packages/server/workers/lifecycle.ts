import { dirname } from "node:path";
import type { Resource } from "webappwiz/disposable";
import type { Fs, Ps } from "webappwiz/system";
import { Duration, type Timer } from "webappwiz/time";
import { splatesHome } from "../models";
import { carried, type WorkerCreds } from "./creds";
import type { WorkerRunOptions } from "./run-options";

/**
 * The environment variable that ends a worker with the process that started
 * it. Set it to that process's pid on the worker `splates server` runs beside
 * itself, and the worker ends once the pid is gone.
 */
// A server killed outright would otherwise leave its worker serving on under
// the id `local` beside the next server's.
export const SUPERVISOR = "SPLATES_WORKER_SUPERVISOR";

/** How often a supervised worker looks for its supervisor. */
const SUPERVISOR_POLL = Duration.secs(5);

/**
 * Calls `end` once the supervisor `SUPERVISOR` names has gone, looking every
 * `SUPERVISOR_POLL`; null for a worker no server supervises.
 */
export function endWithSupervisor(
	ps: Pick<Ps, "env" | "alive">,
	timer: Timer,
	end: () => void,
): Resource | null {
	const pid = Number.parseInt(ps.env(SUPERVISOR) ?? "", 10);
	if (!Number.isInteger(pid)) {
		return null;
	}
	const watch = timer.setInterval(() => {
		if (!ps.alive(pid)) {
			watch.dispose();
			end();
		}
	}, SUPERVISOR_POLL);
	return watch;
}

/**
 * The environment variable that marks a worker another `splates worker run`
 * keeps running. Set it on the worker you keep; told to update, that worker
 * then hands the build over in `updateFile` and exits `UPDATE_EXIT`, for you
 * to start again on that build.
 */
// So each update starts one worker in place of the last, never nesting.
export const WORKER_KEPT = "SPLATES_WORKER_KEPT";

/** What a kept worker exits with when its coordinator asks it to update. */
export const UPDATE_EXIT = 75;

/** Where a kept worker leaves the build it is to restart on. */
export function updateFile(ps: Ps, id: string): string {
	return `${splatesHome(ps)}/workers/${id}.update`;
}

/** Where a worker keeper leaves the build it last started its worker on. */
export function builtFile(ps: Ps, id: string): string {
	return `${splatesHome(ps)}/workers/${id}.build`;
}

/**
 * The build a keeper last updated worker `id` to, when it is newer than
 * `running`, the build this process is: a keeper that pins its own release,
 * a LaunchAgent or a global install, starts on it again after a reboot.
 */
export async function updatedBuild(
	ps: Ps,
	fs: Fs,
	id: string,
	running: string,
): Promise<string | null> {
	if (ps.env(WORKER_KEPT) !== undefined) {
		return null;
	}
	const kept = (await fs.read(builtFile(ps, id)).catch(() => "")).trim();
	return kept !== "" && Bun.semver.order(kept, running) === 1 ? kept : null;
}

/**
 * Runs this worker, one dialing a coordinator elsewhere, again on splates
 * `build`, the coordinator's: one kept already hands the build to the one
 * that keeps it; any other keeps it, starting it again on each build it is
 * told of until it ends some other way. A made worker is never told: it is
 * destroyed and made again from a new snapshot instead.
 */
export async function restartWorker(
	build: string,
	id: string,
	creds: WorkerCreds,
	opts: WorkerRunOptions,
): Promise<void> {
	const { ps, fs, log, coordinator } = opts;
	const path = updateFile(ps, id);
	if (ps.env(WORKER_KEPT) !== undefined) {
		await fs.mkdir(dirname(path));
		await fs.write(path, build);
		ps.exit(UPDATE_EXIT);
		return;
	}
	const env = await carried(creds, opts);
	const stopping = new AbortController();
	const stops = ["SIGINT", "SIGTERM"].map((signal) =>
		ps.on(signal, () => stopping.abort()),
	);
	try {
		let next = build;
		for (;;) {
			log.info(`restarting worker ${id} on splates ${next}`);
			await fs.rm(path, { force: true });
			await fs.mkdir(dirname(path));
			await fs.write(builtFile(ps, id), next);
			const { exitCode } = await ps
				.spawn(
					[
						"bunx",
						`@stringsync/splates@${next}`,
						"worker",
						"run",
						"--coordinator",
						coordinator,
						"--id",
						id,
						"--slots",
						String(opts.slots),
						...(opts.keyFile ? ["--key-file"] : []),
					],
					{ env: { ...env, [WORKER_KEPT]: "1" }, signal: stopping.signal },
				)
				.catch(() => ({ exitCode: 0 }));
			const told = await fs.read(path).catch(() => null);
			if (
				exitCode !== UPDATE_EXIT ||
				told === null ||
				stopping.signal.aborted
			) {
				ps.exit(exitCode);
				return;
			}
			next = told.trim();
		}
	} finally {
		for (const each of stops) {
			each.dispose();
		}
	}
}
