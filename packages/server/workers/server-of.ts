import type { Logger } from "webappwiz/log";
import type { Fs, Ps } from "webappwiz/system";
import { type RelaySend, relayOf } from "../records";
import { FsStorage } from "../storage";
import { keptAccess } from "./creds";

/** The `splates server` a command asks, and how it sends to it. */
export interface ServerOf {
	url: string;
	send: RelaySend;
}

/** What `serverOf` reads to find the server. */
export interface ServerOfOptions {
	dev?: string;
	ps: Ps;
	fs?: Fs;
	log: Logger;
	send?: RelaySend;
}

/**
 * The `splates server` a command reaches: `dev`, else the one the agent's
 * env names, else the server this machine's worker daemon relays to,
 * else one elsewhere through its tunnel with the worker's Access token. An
 * explicit `send` stands in for how it is reached. Null when none says, or
 * when there is no `fs` to read the worker's relay from.
 */
export async function serverOf(
	opts: ServerOfOptions,
): Promise<ServerOf | null> {
	const { dev, ps, fs, log } = opts;
	if (dev) {
		return { url: dev, send: opts.send ?? fetch };
	}
	const env = ps.env("SPLATES_DEV");
	if (env) {
		return { url: env, send: opts.send ?? fetch };
	}
	if (fs === undefined) {
		return null;
	}
	const relay = await relayOf({
		machine: FsStorage.ofMachine({ fs, ps, log }),
		env: (name) => ps.env(name),
		access: (keyFile) => keptAccess({ ps, fs, keyFile }),
	});
	return relay === null
		? null
		: { url: relay.url, send: opts.send ?? relay.send };
}
