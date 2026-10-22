import {
	Credentials,
	Environment,
	MemorySecretStore,
	type SecretStore,
	SystemSecretStore,
} from "webappwiz/creds";
import type { Logger } from "webappwiz/log";
import { makeUndumpable, type Ps } from "webappwiz/system";
import { z } from "zod";
import { KeyFileStore } from "../creds";
import { fail } from "../exit";
import { splatesHome } from "../models";
import {
	type AccessClient,
	accessHeaders,
	joinAccess,
	joinCoordinatorKey,
} from "./access";
import type { WorkerRunOptions } from "./run-options";

/** Where `--key-file` keeps a worker's key. */
export function workerKeyFile(ps: Ps): string {
	return `${splatesHome(ps)}/worker.env`;
}

/**
 * What a joined worker's key is kept as: in the system's store, or the
 * environment where the machine has no store, as a headless one may not.
 */
export const WORKER_KEY = "SPLATES_WORKER_KEY";

/**
 * The id a worker joined as, kept beside its key, so it keeps that id when
 * its hostname changes, as a laptop's does from one network to the next.
 */
export const WORKER_ID = "SPLATES_WORKER_ID";

/**
 * Where a join token may be given instead of `--join`: an argument is in
 * `/proc/<pid>/cmdline` for every user of the machine to read, an
 * environment only for its own user.
 */
export const WORKER_JOIN = "SPLATES_WORKER_JOIN";

/**
 * What the two halves of the service token a worker passes Cloudflare
 * Access with are kept as, beside its key, when its join token carried one.
 */
export const WORKER_ACCESS_ID = "SPLATES_WORKER_ACCESS_ID";
export const WORKER_ACCESS_SECRET = "SPLATES_WORKER_ACCESS_SECRET";

/**
 * The public key of the server that gave a join token, kept beside the
 * worker's key: the worker sends its key only to one that signs its nonce.
 */
export const WORKER_COORDINATOR_KEY = "SPLATES_WORKER_COORDINATOR_KEY";

/** What a joined worker shows its coordinator: its key, and the service token Access lets it through with, if any. */
export interface WorkerCreds {
	key: string;
	access: AccessClient | null;
	/** The server's public key it checks, null for a worker that joined before tokens carried it. */
	coordinator: string | null;
}

const Joined = z.object({ id: z.string(), key: z.string() });

/** A store for the keys a worker is sent, once this process is undumpable. */
export async function undumpableKeys(log: Logger): Promise<MemorySecretStore> {
	const made = await makeUndumpable();
	if (made.undumpable) {
		log.info(`keys stay in memory no other process can read: ${made.how}`);
	} else {
		log.info(
			`other processes of this user may read the keys it holds: ${made.why}`,
		);
	}
	return new MemorySecretStore("this worker's keys");
}

/**
 * `splates worker join`: spends `opts.join` at the server and keeps
 * the key it answers, as `workerRun` would, then exits, for an installer
 * to join now and leave running to a service.
 */
export async function workerJoin(
	opts: Omit<WorkerRunOptions, "slots" | "ephemeral">,
): Promise<void> {
	if (
		!opts.join ||
		opts.coordinator === "" ||
		opts.coordinator.startsWith("unix:")
	) {
		fail(
			"usage",
			"give the server's URL with --server and a token from `splates worker add` there with --join",
		);
	}
	await workerCreds(await workerId(opts), { ...opts, slots: 0 });
}

/**
 * The id a worker of a server elsewhere goes by: `--id`, else the one
 * it joined as, else this machine's hostname.
 */
export async function workerId(
	opts: Pick<WorkerRunOptions, "id" | "ps" | "fs" | "keyFile" | "store">,
): Promise<string> {
	if (opts.id) {
		return opts.id;
	}
	const kept = new Credentials([
		new Environment({ ps: opts.ps }),
		keptStore(opts),
	]);
	return (await kept.get(WORKER_ID).catch(() => undefined)) ?? opts.ps.hostname;
}

/** Where the worker's key is kept: the system's store, or the key file with `--key-file`. */
function keptStore(
	opts: Pick<WorkerRunOptions, "ps" | "fs" | "keyFile" | "store">,
): SecretStore {
	return (
		opts.store ??
		(opts.keyFile
			? new KeyFileStore(workerKeyFile(opts.ps), opts.fs)
			: SystemSecretStore.device())
	);
}

/**
 * The service token the worker on this machine passes Access with, kept
 * where it joined: its key file with `keyFile`, else the system's store, or
 * the environment; null for none, or a store that cannot be read.
 */
export async function keptAccess(
	opts: Pick<WorkerRunOptions, "ps" | "fs" | "keyFile">,
): Promise<AccessClient | null> {
	const kept = new Credentials([
		new Environment({ ps: opts.ps }),
		keptStore(opts),
	]);
	const clientId = await kept.get(WORKER_ACCESS_ID).catch(() => undefined);
	const clientSecret = await kept
		.get(WORKER_ACCESS_SECRET)
		.catch(() => undefined);
	return clientId === undefined || clientSecret === undefined
		? null
		: { clientId, clientSecret };
}

/** Credentials a restarted worker needs when no store or environment already keeps them. */
export async function carried(
	{ key, access, coordinator }: WorkerCreds,
	opts: WorkerRunOptions,
): Promise<Record<string, string>> {
	const kept = await keptStore(opts)
		.get(WORKER_KEY)
		.catch(() => undefined);
	if (kept === key || opts.ps.env(WORKER_KEY) === key) {
		return {};
	}
	return {
		[WORKER_KEY]: key,
		...(coordinator === null ? {} : { [WORKER_COORDINATOR_KEY]: coordinator }),
		...(access === null
			? {}
			: {
					[WORKER_ACCESS_ID]: access.clientId,
					[WORKER_ACCESS_SECRET]: access.clientSecret,
				}),
	};
}

/**
 * The key this worker shows its server, and the service token it
 * passes Access with: joined for now with `--join`, kept in the system's
 * store, or for this run alone where it has none, else the ones kept
 * already.
 */
export async function workerCreds(
	id: string,
	opts: WorkerRunOptions,
): Promise<WorkerCreds> {
	const { ps, log } = opts;
	const store = keptStore(opts);
	if (opts.join) {
		const access = joinAccess(opts.join);
		const key = await joinCoordinator(id, access, opts);
		const coordinator = joinCoordinatorKey(opts.join);
		if (opts.ephemeral) {
			log.info(`joined as ${id}, keeping its key for this run alone`);
			return { key, access, coordinator };
		}
		try {
			await store.set(WORKER_KEY, key);
			await store.set(WORKER_ID, id);
			if (coordinator === null) {
				await store.delete(WORKER_COORDINATOR_KEY);
			} else {
				await store.set(WORKER_COORDINATOR_KEY, coordinator);
			}
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
		return { key, access, coordinator };
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
	await keepId(id, kept, store);
	const coordinator = (await kept.get(WORKER_COORDINATOR_KEY)) ?? null;
	if (coordinator === null) {
		log.info(
			"this coordinator's signing key is not kept, so it cannot be told from an impostor: join again with a new token from `splates worker add` to check it",
		);
	}
	return {
		coordinator,
		key,
		access:
			clientId === undefined || clientSecret === undefined
				? null
				: { clientId, clientSecret },
	};
}

/**
 * Keeps `id` as the one this worker goes by, for one that joined before
 * its id was kept, so a later change of hostname leaves it the same.
 */
async function keepId(
	id: string,
	kept: Credentials,
	store: SecretStore,
): Promise<void> {
	if ((await kept.get(WORKER_ID).catch(() => undefined)) === undefined) {
		await store.set(WORKER_ID, id).catch(() => {});
	}
}

/**
 * Spends `opts.join` at the server, passing Access with `access` when
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
