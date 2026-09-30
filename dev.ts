import { AsyncDisposer, type AsyncResource } from "webappwiz/disposable";
import type { Logger } from "webappwiz/log";
import {
	type Fs,
	MAX_PORT,
	OpenPortProvider,
	type PortProvider,
} from "webappwiz/system";
import type { Assets } from "./dev/assets";
import { Exit, fail, type Reason } from "./exit";
import type { Journal } from "./journal";
import { type Attachment, replyTo } from "./reply";
import { fingerprint, snapshot } from "./snapshot";
import type { Todos } from "./todo";
import type { WorktreeService } from "./worktree-service";

/** Preferred, not required: `dev` moves up from here when it is taken. */
export const DEFAULT_PORT = 4269;

/** How far above the port asked for `dev` will look before giving up. */
export const PORT_SPAN = 20;

/** How often the repo is re-read to decide whether open pages should refetch. */
const POLL_MS = 2_000;

/** The one address the server binds: this machine, and nothing else. */
const LOOPBACK = "127.0.0.1";

/** Names this machine answers to, which a page opened on it always may use. */
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

/** A phone photo fits; a stray video does not. */
const MAX_BODY_BYTES = 25 * 1024 * 1024;

/** How a refusal from the core reads over HTTP. */
const STATUS: Partial<Record<Reason, number>> = {
	usage: 400,
	not_found: 404,
	lease_held: 409,
	exists: 409,
};

/** What `dev` lets a caller choose. */
export interface DevOptions {
	/** Where to listen; the port `--port` asked for, and the span above it. */
	ports?: PortProvider;
	/**
	 * Host names besides this machine's own that the page may be reached by,
	 * like the hostname of a tunnel. Anything else is refused, which is what
	 * stops another site from reading the repo through a browser pointed at
	 * localhost. Who may use those names is the tunnel's business, not arbor's.
	 */
	hosts?: string[];
}

/** A running server, and the one thing a caller ever wants to do with it. */
export interface DevServer extends AsyncResource {
	port: number;
}

/**
 * Serves what `inbox`, `todo list`, `list`, `show` and `log` print, as one page
 * that refetches when the repo changes, and takes the two things a person does
 * from it: `reply` and `todo add`. Nothing more: each is the same core function
 * the CLI calls, and anything that moves a task (merge, remove, claim) stays in
 * the CLI, so a page that should not have been reachable can at worst leave a
 * reply.
 */
export async function dev(
	{
		service,
		fs,
		journal,
		todos,
		log,
		assets,
	}: {
		service: WorktreeService;
		fs: Fs;
		journal: Journal;
		todos: Todos;
		log: Logger;
		assets: Assets;
	},
	{ ports = devPorts(DEFAULT_PORT), hosts = [] }: DevOptions = {},
): Promise<DevServer> {
	const read = () => snapshot({ service, journal, todos, fs });
	const allowed = new Set([...LOCAL_HOSTS, ...hosts]);
	// The page itself is a React app under `dev/`, built before publishing and
	// carried in the bundle, so nothing here builds markup and nothing reads it
	// off disk.
	const open = new Set<ReadableStreamDefaultController<Uint8Array>>();
	const encoder = new TextEncoder();
	let last = fingerprint(await read());

	// ponytail: polls, because arbor's state is spread across records, git refs
	// and ARBOR.md, and one watcher would not cover all three. Watch `.git/arbor`
	// and the worktree roots if two seconds ever feels slow.
	const tick = async (): Promise<void> => {
		const print = fingerprint(await read());
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

	// Every route that reads or writes the repo goes through here. The Host
	// check is what DNS rebinding runs into; the Origin check is what a form on
	// another site posting to this one runs into.
	const guarded =
		(handle: (request: Request) => Promise<Response>) =>
		async (request: Request): Promise<Response> => {
			const host = request.headers.get("host") ?? "";
			if (!allowed.has(hostname(host))) {
				return refuse(
					403,
					"forbidden",
					`host '${host}' is not allowed: pass it to --allow-hosts`,
				);
			}
			const origin = request.headers.get("origin");
			if (
				request.method !== "GET" &&
				(origin === null || new URL(origin).host !== host)
			) {
				return refuse(403, "forbidden", "cross-origin writes are refused");
			}
			try {
				return await handle(request);
			} catch (error) {
				if (error instanceof Exit) {
					return refuse(
						STATUS[error.reason] ?? 400,
						error.reason,
						error.message,
					);
				}
				log.error(String(error));
				return refuse(500, "error", String(error));
			}
		};

	const reply = async (request: Request): Promise<Response> => {
		const form = await request.formData();
		const task = String(form.get("task") ?? "");
		const images: Attachment[] = [];
		for (const file of form.getAll("images")) {
			if (file instanceof File) {
				images.push({
					name: file.name || "pasted.png",
					bytes: new Uint8Array(await file.arrayBuffer()),
				});
			}
		}
		const replied = await journal.record("reply", task, () =>
			replyTo({ service, fs }, task, String(form.get("question") ?? ""), {
				text: String(form.get("text") ?? ""),
				choice: String(form.get("choice") ?? "") || undefined,
				images,
			}),
		);
		await tick();
		return Response.json(replied);
	};

	const addTodo = async (request: Request): Promise<Response> => {
		const { text } = (await request.json()) as { text?: unknown };
		const todo = await journal.record("todo add", null, () =>
			todos.add(String(text ?? ""), null),
		);
		await tick();
		return Response.json(todo.state);
	};

	const requested = await ports.get();
	const server = Bun.serve({
		port: requested,
		// This machine only. Reaching it from anywhere else is a tunnel's job,
		// which connects from here too.
		hostname: LOOPBACK,
		maxRequestBodySize: MAX_BODY_BYTES,
		// Zero never closes an idle connection, which is what the SSE stream needs:
		// it is idle by design between the things it has to say.
		idleTimeout: 0,
		// The static three are handed over without entering JS; the other two have
		// to be asked for, since they answer with the state of the repo right now.
		routes: {
			"/": asset(assets.shell, "text/html; charset=utf-8"),
			"/main.js": asset(assets.script, "text/javascript; charset=utf-8"),
			"/styles.css": asset(assets.styles, "text/css; charset=utf-8"),
			"/api/snapshot": guarded(async () => Response.json(await read())),
			"/api/reply": { POST: guarded(reply) },
			"/api/todos": { POST: guarded(addTodo) },
			"/events": guarded(async () => events()),
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
	return OpenPortProvider.span({ from, span: PORT_SPAN, host: LOOPBACK });
}

/** The host a Host header names, without its port. */
function hostname(host: string): string {
	return host.startsWith("[")
		? host.slice(0, host.indexOf("]") + 1)
		: (host.split(":")[0] ?? "");
}

function refuse(status: number, reason: string, message: string): Response {
	return Response.json({ reason, message }, { status });
}
