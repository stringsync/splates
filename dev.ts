import { AsyncDisposer, type AsyncResource } from "webappwiz/disposable";
import type { Logger } from "webappwiz/log";
import {
	type Fs,
	MAX_PORT,
	OpenPortProvider,
	type PortProvider,
} from "webappwiz/system";
import type { Assets } from "./dev/assets";
import { fail } from "./exit";
import type { Journal } from "./journal";
import { fingerprint, snapshot } from "./snapshot";
import type { WorktreeService } from "./worktree-service";

/** Preferred, not required: `dev` moves up from here when it is taken. */
export const DEFAULT_PORT = 4269;

/** How far above the port asked for `dev` will look before giving up. */
export const PORT_SPAN = 20;

/** How often the repo is re-read to decide whether open pages should refetch. */
const POLL_MS = 2_000;

/** What `dev` lets a caller choose. */
export interface DevOptions {
	/** Where to listen; the port `--port` asked for, and the span above it. */
	ports?: PortProvider;
}

/** A running server, and the one thing a caller ever wants to do with it. */
export interface DevServer extends AsyncResource {
	port: number;
}

/**
 * Serves what `list`, `show` and `log` print, as one page that refetches when the
 * repo changes. Read-only on purpose: driving arbor is what the CLI is for, and
 * a button that took a lease would fight the agent holding it.
 */
export async function dev(
	{
		service,
		fs,
		journal,
		log,
		assets,
	}: {
		service: WorktreeService;
		fs: Fs;
		journal: Journal;
		log: Logger;
		assets: Assets;
	},
	{ ports = devPorts(DEFAULT_PORT) }: DevOptions = {},
): Promise<DevServer> {
	// The page itself is a React app under `dev/`, built before publishing and
	// carried in the bundle, so nothing here builds markup and nothing reads it
	// off disk.
	const open = new Set<ReadableStreamDefaultController<Uint8Array>>();
	const encoder = new TextEncoder();
	let last = fingerprint(await snapshot(service, journal, { fs }));

	// ponytail: polls, because arbor's state is spread across records, git refs
	// and ARBOR.md, and one watcher would not cover all three. Watch `.git/arbor`
	// and the worktree roots if two seconds ever feels slow.
	const tick = async (): Promise<void> => {
		const print = fingerprint(await snapshot(service, journal, { fs }));
		if (print === last) {
			return;
		}
		last = print;
		for (const stream of open) {
			stream.enqueue(encoder.encode("data: changed\n\n"));
		}
	};
	const poll = setInterval(() => {
		tick().catch((error: unknown) => log.error(String(error)));
	}, POLL_MS);

	const events = (): Response => {
		let self: ReadableStreamDefaultController<Uint8Array> | null = null;
		return new Response(
			new ReadableStream<Uint8Array>({
				start: (stream) => {
					self = stream;
					open.add(stream);
					// A comment, ignored by EventSource. Without a first chunk the
					// response headers never reach the client and the page hangs
					// waiting to connect.
					stream.enqueue(encoder.encode(": connected\n\n"));
				},
				cancel: () => {
					if (self) {
						open.delete(self);
					}
				},
			}),
			{
				headers: {
					"content-type": "text/event-stream",
					"cache-control": "no-cache",
				},
			},
		);
	};

	const asset = (body: string, type: string): Response =>
		new Response(body, { headers: { "content-type": type } });

	const requested = await ports.get();
	const server = Bun.serve({
		port: requested,
		// Zero never closes an idle connection, which is what the SSE stream needs:
		// it is idle by design between the things it has to say.
		idleTimeout: 0,
		// The static three are handed over without entering JS; the other two have
		// to be asked for, since they answer with the state of the repo right now.
		routes: {
			"/": asset(assets.shell, "text/html; charset=utf-8"),
			"/main.js": asset(assets.script, "text/javascript; charset=utf-8"),
			"/styles.css": asset(assets.styles, "text/css; charset=utf-8"),
			"/api/snapshot": async () =>
				Response.json(await snapshot(service, journal, { fs })),
			"/events": events,
		},
		fetch: () => new Response("not found", { status: 404 }),
	});
	// Read back, because `ports` may hand over 0 to mean any port at all, and
	// read now, because `server.port` is 0 once the server is stopped and this is
	// handed to a caller that stops it. Undefined only for a unix socket, which
	// this never asks for.
	const port = server.port ?? requested;

	log.info(`arbor dev on http://localhost:${port}`);
	const disposer = new AsyncDisposer();
	// true drains open connections rather than cutting them mid-response
	disposer.defer(() => server.stop(true));
	disposer.defer(async () => clearInterval(poll));
	return {
		port,
		disposeAsync: disposer.disposeAsync,
	};
}

/**
 * Where `dev` will listen, given the port asked for. A flag is outside input,
 * so a port that cannot exist is a refusal with an exit code rather than the
 * assertion `OpenPortProvider` would raise for a bug in here.
 */
export function devPorts(from: number): PortProvider {
	if (!Number.isInteger(from) || from < 0 || from > MAX_PORT) {
		fail(
			"usage",
			`invalid port '${from}': use a whole number 0 to ${MAX_PORT}`,
			{
				port: from,
			},
		);
	}
	return OpenPortProvider.span({ from, span: PORT_SPAN });
}
