import type { Logger } from "webappwiz/log";
import type { Fs, Ps } from "webappwiz/system";
import { fail } from "./exit";
import { arborHome } from "./roster";
import { UnixWorkerSocket } from "./unix-worker-socket";
import { WebSocketWorkerSocket } from "./websocket-worker-socket";
import { WorkerDaemon, type WorkerDialer } from "./worker-daemon";

/** Where the local worker finds the coordinator on this machine. */
export function workerSocketPath(ps: Ps): string {
	return `${arborHome(ps)}/worker.sock`;
}

/** What `arbor worker run` is run with. */
export interface WorkerRunOptions {
	/** Empty for this machine's coordinator, a URL for another's, or `unix:<path>`. */
	coordinator: string;
	slots: number;
	id: string;
	log: Logger;
	ps: Ps;
	fs: Fs;
}

/**
 * `arbor worker run`: a worker that serves its coordinator until a SIGINT
 * or SIGTERM, or until the coordinator refuses it for speaking another
 * protocol, which is a refusal to update one or the other.
 */
export async function workerRun(opts: WorkerRunOptions): Promise<void> {
	const { ps, log } = opts;
	const daemon = new WorkerDaemon(dialer(opts.coordinator, ps), {
		id: opts.id || ps.hostname,
		slots: opts.slots,
		ps,
		fs: opts.fs,
		log,
	});
	const stopping = [
		ps.on("SIGINT", () => void daemon.disposeAsync()),
		ps.on("SIGTERM", () => void daemon.disposeAsync()),
	];
	try {
		const ended = await daemon.run();
		if ("refused" in ended) {
			fail("outdated", `the coordinator refused this worker: ${ended.refused}`);
		}
	} finally {
		for (const each of stopping) {
			each.dispose();
		}
		await daemon.disposeAsync();
	}
}

function dialer(coordinator: string, ps: Ps): WorkerDialer {
	if (coordinator === "" || coordinator.startsWith("unix:")) {
		const path =
			coordinator === "" ? workerSocketPath(ps) : coordinator.slice(5);
		return { where: path, dial: () => UnixWorkerSocket.connect(path) };
	}
	const url = new URL("/api/workers", coordinator);
	url.protocol =
		url.protocol === "https:" || url.protocol === "wss:" ? "wss:" : "ws:";
	const where = url.toString();
	return { where, dial: () => WebSocketWorkerSocket.connect(where) };
}
