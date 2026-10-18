import {
	Credentials,
	Environment,
	type SecretStore,
	SystemSecretStore,
} from "webappwiz/creds";
import type { Logger } from "webappwiz/log";
import type { Fs, Ps } from "webappwiz/system";
import { z } from "zod";
import { WORKER_KEY_HEADER, workerAuthorization } from "../dev-workers";
import { fail } from "../exit";
import { relayFile } from "../repo-state";
import { splatesHome } from "../roster";
import { WorkerDaemon, type WorkerDialer } from "./daemon";
import { UnixWorkerSocket } from "./unix-socket";
import { WebSocketWorkerSocket } from "./websocket-socket";

/** Where the local worker finds the coordinator on this machine. */
export function workerSocketPath(ps: Ps): string {
	return `${splatesHome(ps)}/worker.sock`;
}

/**
 * What a joined worker's key is kept as: in the system's store, or the
 * environment where the machine has no store, as a headless one may not.
 */
export const WORKER_KEY = "SPLATES_WORKER_KEY";

const Joined = z.object({ id: z.string(), key: z.string() });

/** What `splates worker run` is run with. */
export interface WorkerRunOptions {
	/** Empty for this machine's coordinator, a URL for another's, or `unix:<path>`. */
	coordinator: string;
	slots: number;
	id: string;
	/** A join token from `splates worker add`, spent to join before dialing; empty when joined already. */
	join?: string;
	log: Logger;
	ps: Ps;
	fs: Fs;
	/** Where the worker's key is kept; the device's system store by default. */
	store?: SecretStore;
	send?: typeof fetch;
}

/**
 * `splates worker run`: a worker that serves its coordinator until a SIGINT
 * or SIGTERM, or until the coordinator refuses it for speaking another
 * protocol, which is a refusal to update one or the other.
 */
export async function workerRun(opts: WorkerRunOptions): Promise<void> {
	const { ps, log } = opts;
	const id = opts.id || ps.hostname;
	const daemon = new WorkerDaemon(await dialer(id, opts), {
		id,
		slots: opts.slots,
		ps,
		fs: opts.fs,
		log,
		relayAt: relayFile(splatesHome(ps)),
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

async function dialer(
	id: string,
	opts: WorkerRunOptions,
): Promise<WorkerDialer> {
	const { coordinator, ps } = opts;
	if (coordinator === "" || coordinator.startsWith("unix:")) {
		if (opts.join) {
			fail(
				"usage",
				"--join is for a coordinator on another machine: give its URL with --coordinator",
			);
		}
		const path =
			coordinator === "" ? workerSocketPath(ps) : coordinator.slice(5);
		return { where: path, dial: () => UnixWorkerSocket.connect(path) };
	}
	const key = await workerKey(id, opts);
	const url = new URL("/api/workers", coordinator);
	url.protocol =
		url.protocol === "https:" || url.protocol === "wss:" ? "wss:" : "ws:";
	const where = url.toString();
	const headers = { [WORKER_KEY_HEADER]: workerAuthorization(id, key) };
	return { where, dial: () => WebSocketWorkerSocket.connect(where, headers) };
}

/**
 * The key this worker shows its coordinator: joined for now with `--join`,
 * kept in the system's store, else the one kept already.
 */
export async function workerKey(
	id: string,
	opts: WorkerRunOptions,
): Promise<string> {
	const { ps, log } = opts;
	const store = opts.store ?? SystemSecretStore.device();
	if (opts.join) {
		const key = await joinCoordinator(id, opts);
		try {
			await store.set(WORKER_KEY, key);
			log.info(`joined as ${id}; its key is kept in ${store.label}`);
		} catch (error) {
			// Never printed: a key in a terminal's scrollback is a key leaked.
			fail(
				"usage",
				`joined as ${id}, but ${store.label} could not keep its key (${error instanceof Error ? error.message : String(error)}): remove the worker, then join again on a machine with a secret service`,
			);
		}
		return key;
	}
	const key = await new Credentials([new Environment({ ps }), store]).get(
		WORKER_KEY,
	);
	if (key === undefined) {
		fail(
			"usage",
			"this worker has not joined that coordinator: run `splates worker add` there for a join token, then `splates worker run --join <token>` here",
		);
	}
	return key;
}

/** Spends `opts.join` at the coordinator, answering the key it gave worker `id`. */
async function joinCoordinator(
	id: string,
	opts: WorkerRunOptions,
): Promise<string> {
	const send = opts.send ?? fetch;
	const url = new URL("/api/workers", opts.coordinator);
	let response: Response;
	try {
		response = await send(url, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ token: opts.join, id }),
		});
	} catch (error) {
		fail(
			"not_found",
			`the coordinator at ${opts.coordinator} could not be reached: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (!response.ok) {
		fail(
			"usage",
			`the coordinator did not let this worker join: ${response.status} ${await response.text()}`,
		);
	}
	return Joined.parse(await response.json()).key;
}
