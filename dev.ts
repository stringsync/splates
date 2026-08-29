import type { HttpServer } from "webappwiz/http";
import type { Logger } from "webappwiz/log";
import type { Fs, PortProvider } from "webappwiz/system";
import { Duration } from "webappwiz/time";
import type { Assets } from "./dev/assets";
import type { Journal } from "./journal";
import { fingerprint, snapshot } from "./snapshot";
import type { WorktreeService } from "./worktree-service";

/** Preferred, not required: `dev` moves up from here when it is taken. */
export const DEFAULT_PORT = 4269;

/** How often the repo is re-read to decide whether open pages should refetch. */
const POLL_MS = 2_000;

/** A running server, and the one thing a caller ever wants to do with it. */
export interface DevServer {
	port: number;
	stop(): Promise<void>;
}

/**
 * Serves what `ls`, `show` and `log` print, as one page that refetches when the
 * repo changes. Read-only on purpose: driving arbor is what the CLI is for, and
 * a button that took a lease would fight the agent holding it.
 *
 * The page itself is a React app under `dev/`, built before publishing and
 * carried in the bundle, so nothing here builds markup and nothing reads it
 * off disk.
 */
export async function dev(
	{
		service,
		fs,
		journal,
		log,
		http,
		assets,
		ports,
	}: {
		service: WorktreeService;
		fs: Fs;
		journal: Journal;
		log: Logger;
		http: HttpServer;
		assets: Assets;
		ports: PortProvider;
	},
	{ port = DEFAULT_PORT } = {},
): Promise<DevServer> {
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

	const listening = await http.serve(
		async (request) => {
			switch (new URL(request.url).pathname) {
				case "/":
					return new Response(assets.shell, {
						headers: { "content-type": "text/html; charset=utf-8" },
					});
				case "/main.js":
					return new Response(assets.script, {
						headers: { "content-type": "text/javascript; charset=utf-8" },
					});
				case "/styles.css":
					return new Response(assets.styles, {
						headers: { "content-type": "text/css; charset=utf-8" },
					});
				case "/api/snapshot":
					return Response.json(await snapshot(service, journal, { fs }));
				case "/events":
					return events();
				default:
					return new Response("not found", { status: 404 });
			}
		},
		// An SSE stream is idle by design between changes, and would otherwise be
		// closed out from under the page.
		{ port: await ports.get(port), idleTimeout: Duration.zero() },
	);

	log.info(`arbor dev on http://localhost:${listening.port}`);
	return {
		port: listening.port,
		stop: async () => {
			clearInterval(poll);
			await listening.stop();
		},
	};
}
