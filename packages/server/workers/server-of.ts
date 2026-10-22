import type { Logger } from "webappwiz/log";
import type { Fs, Ps } from "webappwiz/system";

/** How a command sends the `splates server` a request: `fetch`, or a stand-in. */
export type ServerSend = (url: string, init: RequestInit) => Promise<Response>;

/** The `splates server` a command asks, and how it sends to it. */
export interface ServerOf {
	url: string;
	send: ServerSend;
}

/** What `serverOf` reads to find the server. */
export interface ServerOfOptions {
	dev?: string;
	ps: Ps;
	fs?: Fs;
	log: Logger;
	send?: ServerSend;
}

/**
 * The `splates server` a command reaches: `dev`, else the one the agent's
 * env names. An explicit `send` stands in for how it is reached. Null when
 * neither says.
 */
export async function serverOf(
	opts: ServerOfOptions,
): Promise<ServerOf | null> {
	const { dev, ps } = opts;
	const url = dev || ps.env("SPLATES_DEV");
	return url ? { url, send: opts.send ?? fetch } : null;
}
