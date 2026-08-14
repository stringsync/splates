import type { HttpServer } from "@webappwiz/http";
import type { Logger } from "@webappwiz/log";
import type { Fs } from "@webappwiz/sys";
import { Duration } from "@webappwiz/time";
import { Assets } from "./dev/assets";
import type { Bundler } from "./dev/bundler/bundler";
import type { Journal } from "./journal";
import { fingerprint, snapshot } from "./snapshot";
import type { WorktreeService } from "./worktree-service";

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
 * The page itself is a React app under `dev/`, bundled on the way out, so
 * nothing here builds markup.
 */
export async function dev(
	{
		service,
		fs,
		journal,
		log,
		http,
		bundler,
	}: {
		service: WorktreeService;
		fs: Fs;
		journal: Journal;
		log: Logger;
		http: HttpServer;
		bundler: Bundler;
	},
	{ port = DEFAULT_PORT } = {},
): Promise<DevServer> {
	const open = new Set<ReadableStreamDefaultController<Uint8Array>>();
	const encoder = new TextEncoder();
	const assets = new Assets(bundler, { fs });
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

	// Built once, on the first page load, and held: both come out of source files
	// that cannot change while the CLI is running.
	let js: Promise<string> | null = null;
	let css: Promise<string> | null = null;

	const main = async (): Promise<Response> => {
		js ??= assets.script();
		try {
			return new Response(await js, {
				headers: { "content-type": "text/javascript; charset=utf-8" },
			});
		} catch (error) {
			// A page that mounts nothing is a blank screen with nothing in the
			// console, so say it here where the person who ran the command is
			// looking. Cleared so the next reload tries again.
			js = null;
			log.error(`could not build the dev page: ${String(error)}`);
			return new Response(String(error), { status: 500 });
		}
	};

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
					return new Response(await assets.shell(), {
						headers: { "content-type": "text/html; charset=utf-8" },
					});
				case "/main.js":
					return main();
				case "/styles.css":
					css ??= assets.styles();
					return new Response(await css, {
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
		{ port, idleTimeout: Duration.zero() },
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
