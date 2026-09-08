import type { Duration } from "webappwiz/time";

/**
 * HttpServer is the seam that binds a port. Typically, this is assigned the
 * variable name `http`.
 *
 * What it serves is a plain `fetch`, the shape every fetch-style runtime
 * already takes, so a handler written against this runs unchanged on whatever
 * ends up listening for it.
 */
export interface HttpServer {
	serve(handler: Handler, opts: ServeOptions): Promise<Listening>;
}

export type Handler = (request: Request) => Response | Promise<Response>;

export interface ServeOptions {
	/** Pass 0 to take whatever port is free, then read `Listening.port` back. */
	port: number;
	/**
	 * How long a connection may sit idle before it is closed. Zero never closes
	 * one, which is what a server-sent-events stream needs: it is idle by design
	 * between the things it has to say.
	 */
	idleTimeout: Duration;
}

/** A bound port, and the one thing a caller ever wants to do with it. */
export interface Listening {
	/** What was actually bound, which is the point of asking for port 0. */
	port: number;
	/** Resolves once open connections are closed. */
	stop(): Promise<void>;
}

/** Listens with `Bun.serve`, which is the only thing in here that knows Bun. */
export class BunHttpServer implements HttpServer {
	async serve(handler: Handler, opts: ServeOptions): Promise<Listening> {
		const server = Bun.serve({
			port: opts.port,
			// Bun counts this in whole seconds and rejects anything else
			idleTimeout: Math.round(opts.idleTimeout.secs),
			fetch: handler,
		});
		return {
			// Undefined only for a unix socket, which this never asks for. Reading it
			// back matters for port 0, where the port is whatever was free.
			port: server.port ?? opts.port,
			// true drains open connections rather than cutting them mid-response
			stop: () => server.stop(true),
		};
	}
}
