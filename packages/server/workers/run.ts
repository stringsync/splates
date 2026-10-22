import { availableParallelism, totalmem } from "node:os";
import type { Ps } from "webappwiz/system";
import { SystemTimer } from "webappwiz/time";
import { fail } from "../exit";
import { splatesHome } from "../models";
import { RUNNING } from "../server/shared";
import { accessHeaders } from "./access";
import { type WorkerCreds, workerCreds, workerId } from "./creds";
import { WorkerDaemon, type WorkerDialer, type WorkerEnded } from "./daemon";
import { endWithSupervisor, restartWorker, updatedBuild } from "./lifecycle";
import { machineSlots } from "./machine";
import { WORKER_SOCKET_PATH } from "./routes";
import type { WorkerRunOptions } from "./run-options";
import { AgentSandbox } from "./sandbox";
import { UnixWorkerSocket } from "./unix-socket";
import { WebSocketWorkerSocket } from "./websocket-socket";
import { WORKER_KEY_HEADER, workerAuthorization } from "./worker-key";

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
	const remote = !(
		opts.coordinator === "" || opts.coordinator.startsWith("unix:")
	);
	// This machine's own goes by its hostname, as its server finds it.
	const id = remote ? await workerId(opts) : opts.id || ps.hostname;
	const creds = remote ? await workerCreds(id, opts) : null;
	// A keeper pinned to the release it was set up on starts on the build
	// the worker last updated to instead.
	const updated =
		creds === null ? null : await updatedBuild(ps, opts.fs, id, RUNNING);
	if (creds !== null && updated !== null) {
		log.info(`starting on splates ${updated}, the build last updated to`);
		await restartWorker(updated, id, creds, opts);
		return;
	}
	// Its agents work in the person's own worktrees, whose `.git` a sandbox
	// would leave read-only.
	const sandbox = remote ? await agentSandbox(opts) : null;
	const daemon = new WorkerDaemon(dialer(id, creds, opts), {
		id,
		slots: opts.slots || machineSlots(availableParallelism(), totalmem()),
		ps,
		fs: opts.fs,
		log,
		sandbox,
	});
	const stopping = [
		ps.on("SIGINT", () => void daemon.disposeAsync()),
		ps.on("SIGTERM", () => void daemon.disposeAsync()),
		// The spot watcher on a cloud machine sends this when its reclaim notice comes.
		ps.on("SIGUSR1", () => {
			log.info("the machine is being reclaimed: telling the coordinator");
			daemon.leaving("spot interruption");
		}),
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
	if ("update" in ended && ended.update !== undefined && creds !== null) {
		await restartWorker(ended.update, id, creds, opts);
		return;
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

/**
 * Where a Linux worker of a server elsewhere runs its agents, each
 * kept from the others; none,
 * said in the log, where it cannot sandbox one, as on macOS or a machine
 * without bubblewrap, whose agents then run as this worker's user.
 */
async function agentSandbox({
	ps,
	fs,
	log,
}: WorkerRunOptions): Promise<AgentSandbox | null> {
	if (ps.platform !== "linux") {
		return null;
	}
	const probed = await AgentSandbox.probe(ps, fs);
	if (typeof probed === "string") {
		log.info(
			`agents run unsandboxed, able to read each other's keys and files: ${probed}`,
		);
		return null;
	}
	log.info("each agent runs in a sandbox of its own (bubblewrap)");
	return probed;
}

/** The coordinators a worker may dial without TLS: ones on its own machine. */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function dialer(
	id: string,
	creds: WorkerCreds | null,
	opts: WorkerRunOptions,
): WorkerDialer {
	const { coordinator, ps } = opts;
	if (creds === null) {
		if (opts.join) {
			fail(
				"usage",
				"--join is for a server on another machine: give its URL with --server",
			);
		}
		const path =
			coordinator === "" ? workerSocketPath(ps) : coordinator.slice(5);
		return { where: path, dial: () => UnixWorkerSocket.connect(path) };
	}
	const { key, access, coordinator: signer } = creds;
	const url = new URL(WORKER_SOCKET_PATH, coordinator);
	url.protocol =
		url.protocol === "https:" || url.protocol === "wss:" ? "wss:" : "ws:";
	if (url.protocol === "ws:" && !LOCAL_HOSTS.has(url.hostname)) {
		fail(
			"usage",
			`${coordinator} would send this worker's key in the clear: give an https:// URL for a coordinator on another machine`,
		);
	}
	const where = url.toString();
	// A worker that knows its server's key sends its own only in its
	// hello, once the server has signed its nonce: a key in the upgrade
	// goes to whoever answers the dial, as a stolen tunnel token lets anyone.
	const headers =
		signer === null
			? {
					...accessHeaders(access),
					[WORKER_KEY_HEADER]: workerAuthorization(id, key),
				}
			: accessHeaders(access);
	return {
		where,
		dial: () => WebSocketWorkerSocket.connect(where, headers),
		...(signer === null ? {} : { verify: { coordinator: signer, key } }),
	};
}
