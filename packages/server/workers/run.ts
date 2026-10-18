import { dirname } from "node:path";
import {
	Credentials,
	Environment,
	type SecretStore,
	SystemSecretStore,
} from "webappwiz/creds";
import type { Logger } from "webappwiz/log";
import type { Fs, Ps } from "webappwiz/system";
import { SystemTimer } from "webappwiz/time";
import { z } from "zod";
import { SharedBrowser } from "../agents";
import { fail } from "../exit";
import { splatesHome } from "../models";
import { relayFile } from "../records";
import { heavyJobsOfMachine } from "../server/shared";
import { type AccessClient, accessHeaders, joinAccess } from "./access";
import { WorkerDaemon, type WorkerDialer, type WorkerEnded } from "./daemon";
import { WORKER_KEY_HEADER, workerAuthorization } from "./routes";
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

/**
 * What the two halves of the service token a worker passes Cloudflare
 * Access with are kept as, beside its key, when its join token carried one.
 */
export const WORKER_ACCESS_ID = "SPLATES_WORKER_ACCESS_ID";
export const WORKER_ACCESS_SECRET = "SPLATES_WORKER_ACCESS_SECRET";

/** What a joined worker shows its coordinator: its key, and the service token Access lets it through with, if any. */
export interface WorkerCreds {
	key: string;
	access: AccessClient | null;
}

const Joined = z.object({ id: z.string(), key: z.string() });

/** What `splates worker run` is run with. */
export interface WorkerRunOptions {
	/** Empty for this machine's coordinator, a URL for another's, or `unix:<path>`. */
	coordinator: string;
	slots: number;
	id: string;
	/** A join token from `splates worker add`, spent to join before dialing; empty when joined already. */
	join?: string;
	/**
	 * Keeps the key `join` answers in memory alone, for a machine that is
	 * destroyed rather than restarted, as one a provider makes, which may
	 * have no system store to keep it in.
	 */
	ephemeral?: boolean;
	log: Logger;
	ps: Ps;
	fs: Fs;
	/** Where the worker's key is kept; the device's system store by default. */
	store?: SecretStore;
	send?: typeof fetch;
}

/**
 * Set in the environment of a worker that another `splates worker run`
 * keeps; told to update, it leaves the build in `updateFile` and exits
 * `UPDATE_EXIT`, for the one keeping it to start the next.
 */
// So each update starts one worker in place of the last, never nesting.
export const WORKER_KEPT = "SPLATES_WORKER_KEPT";

/** What a kept worker exits with when its coordinator asks it to update. */
export const UPDATE_EXIT = 75;

/** Where a kept worker leaves the build it is to restart on. */
export function updateFile(ps: Ps, id: string): string {
	return `${splatesHome(ps)}/workers/${id}.update`;
}

/**
 * `splates worker run`: serves the coordinator until a SIGINT or SIGTERM.
 * Told the coordinator's build, once its agents have moved off it or when
 * refused for speaking another protocol, it restarts on that build
 * (`restartWorker`); refused with no build, it exits `outdated`.
 */
export async function workerRun(opts: WorkerRunOptions): Promise<void> {
	const { ps, log } = opts;
	const id = opts.id || ps.hostname;
	// Started on the first session that asks, so a worker whose agents all
	// run on the coordinator's own machine never starts one.
	const browser = new SharedBrowser(
		{
			ps,
			fs: opts.fs,
			timer: new SystemTimer(),
			log,
			heavy: heavyJobsOfMachine({ fs: opts.fs, ps, log }),
		},
		splatesHome(ps),
	);
	const remote = !(
		opts.coordinator === "" || opts.coordinator.startsWith("unix:")
	);
	const creds = remote ? await workerCreds(id, opts) : null;
	const daemon = new WorkerDaemon(dialer(id, creds, opts), {
		id,
		slots: opts.slots,
		ps,
		fs: opts.fs,
		log,
		relayAt: relayFile(splatesHome(ps)),
		servers: browser,
	});
	const stopping = [
		ps.on("SIGINT", () => void daemon.disposeAsync()),
		ps.on("SIGTERM", () => void daemon.disposeAsync()),
	];
	let ended: WorkerEnded;
	try {
		ended = await daemon.run();
	} finally {
		for (const each of stopping) {
			each.dispose();
		}
		await daemon.disposeAsync();
		await browser.disposeAsync();
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

/**
 * What the worker started on another build needs in its environment to
 * show its coordinator who it is: nothing when the system's store keeps its
 * key and service token, else those the join answered for this run alone.
 */
async function carried(
	{ key, access }: WorkerCreds,
	opts: WorkerRunOptions,
): Promise<Record<string, string>> {
	const store = opts.store ?? SystemSecretStore.device();
	const kept = await store.get(WORKER_KEY).catch(() => undefined);
	if (kept === key || opts.ps.env(WORKER_KEY) === key) {
		return {};
	}
	return {
		[WORKER_KEY]: key,
		...(access === null
			? {}
			: {
					[WORKER_ACCESS_ID]: access.clientId,
					[WORKER_ACCESS_SECRET]: access.clientSecret,
				}),
	};
}

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
				"--join is for a coordinator on another machine: give its URL with --coordinator",
			);
		}
		const path =
			coordinator === "" ? workerSocketPath(ps) : coordinator.slice(5);
		return { where: path, dial: () => UnixWorkerSocket.connect(path) };
	}
	const { key, access } = creds;
	const url = new URL("/api/workers", coordinator);
	url.protocol =
		url.protocol === "https:" || url.protocol === "wss:" ? "wss:" : "ws:";
	const where = url.toString();
	const headers = {
		...accessHeaders(access),
		[WORKER_KEY_HEADER]: workerAuthorization(id, key),
	};
	return { where, dial: () => WebSocketWorkerSocket.connect(where, headers) };
}

/**
 * The key this worker shows its coordinator, and the service token it
 * passes Access with: joined for now with `--join`, kept in the system's
 * store, or for this run alone where it has none, else the ones kept
 * already.
 */
export async function workerCreds(
	id: string,
	opts: WorkerRunOptions,
): Promise<WorkerCreds> {
	const { ps, log } = opts;
	const store = opts.store ?? SystemSecretStore.device();
	if (opts.join) {
		const access = joinAccess(opts.join);
		const key = await joinCoordinator(id, access, opts);
		if (opts.ephemeral) {
			log.info(`joined as ${id}, keeping its key for this run alone`);
			return { key, access };
		}
		try {
			await store.set(WORKER_KEY, key);
			if (access === null) {
				await store.delete(WORKER_ACCESS_ID);
				await store.delete(WORKER_ACCESS_SECRET);
			} else {
				await store.set(WORKER_ACCESS_ID, access.clientId);
				await store.set(WORKER_ACCESS_SECRET, access.clientSecret);
			}
			log.info(`joined as ${id}; its key is kept in ${store.label}`);
		} catch (error) {
			// A headless box, such as a container, may have no secret service.
			// The key stays in memory rather than printed: a key in a
			// terminal's scrollback is a key leaked.
			log.error(
				`joined as ${id}, but ${store.label} could not keep its key (${error instanceof Error ? error.message : String(error)}): it lasts this run only, so run again with a new join token`,
			);
		}
		return { key, access };
	}
	const kept = new Credentials([new Environment({ ps }), store]);
	const key = await kept.get(WORKER_KEY);
	if (key === undefined) {
		fail(
			"usage",
			"this worker has not joined that coordinator: run `splates worker add` there for a join token, then `splates worker run --join <token>` here",
		);
	}
	const clientId = await kept.get(WORKER_ACCESS_ID);
	const clientSecret = await kept.get(WORKER_ACCESS_SECRET);
	return {
		key,
		access:
			clientId === undefined || clientSecret === undefined
				? null
				: { clientId, clientSecret },
	};
}

/**
 * Spends `opts.join` at the coordinator, passing Access with `access` when
 * given, answering the key it gave worker `id`.
 */
async function joinCoordinator(
	id: string,
	access: AccessClient | null,
	opts: WorkerRunOptions,
): Promise<string> {
	const send = opts.send ?? fetch;
	const url = new URL("/api/workers/join", opts.coordinator);
	let response: Response;
	try {
		response = await send(url, {
			method: "POST",
			headers: {
				...accessHeaders(access),
				"content-type": "application/json",
			},
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
