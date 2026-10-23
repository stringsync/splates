import { availableParallelism, totalmem } from "node:os";
import type { Ps } from "webappwiz/system";
import { SystemTimer } from "webappwiz/time";
import { fail } from "../exit";
import { splatesHome } from "../models";
import { WorkerDaemon, type WorkerDialer, type WorkerEnded } from "./daemon";
import { endWithSupervisor } from "./lifecycle";
import { machineSlots } from "./machine";
import type { WorkerRunOptions } from "./run-options";
import { UnixWorkerSocket } from "./unix-socket";

/** Where the local worker finds the server on this machine. */
export function workerSocketPath(ps: Ps): string {
	return `${splatesHome(ps)}/worker.sock`;
}

/**
 * `splates worker run`: serves the server until a SIGINT or SIGTERM,
 * restarting on the server's build when told it, and exiting
 * `outdated` when refused without one.
 */
export async function workerRun(opts: WorkerRunOptions): Promise<void> {
	const { ps, log } = opts;
	if (opts.coordinator !== "" && !opts.coordinator.startsWith("unix:")) {
		fail("usage", "workers connect only to this machine's Unix socket");
	}
	const id = opts.id || "local";
	const daemon = new WorkerDaemon(dialer(opts), {
		id,
		slots: opts.slots || machineSlots(availableParallelism(), totalmem()),
		ps,
		fs: opts.fs,
		log,
	});
	const stopping = [
		ps.on("SIGINT", () => void daemon.disposeAsync()),
		ps.on("SIGTERM", () => void daemon.disposeAsync()),
		endWithSupervisor(ps, new SystemTimer(), () => {
			log.info("stopping: the server that started this worker is gone");
			void daemon.disposeAsync();
		}),
	].filter((each) => each !== null);
	let ended: WorkerEnded;
	try {
		ended = await daemon.run();
	} finally {
		for (const each of stopping) {
			each.dispose();
		}
		await daemon.disposeAsync();
	}
	// This machine's own: the `splates server` keeping it starts it again on
	// its own splates.
	if ("update" in ended && !("refused" in ended)) {
		return;
	}
	if ("refused" in ended) {
		fail("outdated", `the coordinator refused this worker: ${ended.refused}`);
	}
}

function dialer(opts: WorkerRunOptions): WorkerDialer {
	const path =
		opts.coordinator === ""
			? workerSocketPath(opts.ps)
			: opts.coordinator.slice(5);
	return { where: path, dial: () => UnixWorkerSocket.connect(path) };
}
