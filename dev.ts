import { AsyncDisposer, type AsyncResource } from "webappwiz/disposable";
import type { Logger } from "webappwiz/log";
import {
	type Fs,
	MAX_PORT,
	OpenPortProvider,
	type PortProvider,
	type Ps,
} from "webappwiz/system";
import type { Attachment } from "./attachments";
import type { Assets } from "./dev/assets";
import { Exit, fail, type Reason } from "./exit";
import type { Journal } from "./journal";
import { fingerprint, snapshot } from "./snapshot";
import type { Todos } from "./todos";
import type { WorktreeService } from "./worktree-service";

/** Preferred, not required: `dev` moves up from here when it is taken. */
export const DEFAULT_PORT = 4269;

/** How far above the port asked for `dev` will look before giving up. */
export const PORT_SPAN = 20;

/**
 * Serves what `todo list`, `list` and `show` print as one page that refetches
 * when the repo changes, where a person adds, edits, reorders and removes
 * todos. Anything that moves a task (merge, remove, claim) stays in the CLI,
 * so a page that should not have been reachable can at worst change a todo.
 */
export async function dev(
	{
		service,
		fs,
		ps,
		journal,
		todos,
		log,
		assets,
	}: {
		service: WorktreeService;
		fs: Fs;
		ps: Ps;
		journal: Journal;
		todos: Todos;
		log: Logger;
		assets: Assets;
	},
	{ ports = devPorts(DEFAULT_PORT), hosts = [] }: DevOptions = {},
): Promise<DevServer> {
	const home = ps.env("HOME");
	const read = () => snapshot({ service, todos, fs, home });
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

	// Only a file a todo holds, so the page, and whoever a tunnel lets reach
	// it, can read nothing on this machine that was not put there on purpose.
	const file = async (request: Request): Promise<Response> => {
		const params = new URL(request.url).searchParams;
		const path = params.get("path") ?? "";
		const type = IMAGE_TYPES[path.split(".").at(-1)?.toLowerCase() ?? ""];
		const bytes = todos.owns(path)
			? await fs.readBytes(path).catch(() => null)
			: null;
		if (bytes === null) {
			return refuse(404, "not_found", `nothing here shows ${path}`);
		}
		return new Response(new Blob([bytes as Uint8Array<ArrayBuffer>]), {
			headers: {
				"content-type": type ?? "application/octet-stream",
				// Anything not an image downloads rather than rendering here.
				...(type === undefined ? { "content-disposition": "attachment" } : {}),
				// An svg opened on its own could otherwise run a script.
				"content-security-policy":
					"default-src 'none'; style-src 'unsafe-inline'",
				"x-content-type-options": "nosniff",
			},
		});
	};

	// Names only, and only what git would show anyone with the repo: enough to
	// point an agent at a file with `@`, and nothing inside one.
	const paths = async (request: Request): Promise<Response> => {
		const task = new URL(request.url).searchParams.get("task") ?? "";
		const worktree = task === "" ? null : await service.find(task);
		if (worktree !== null && !worktree.exists) {
			fail("not_found", `no worktree for '${task}'`, { task });
		}
		return Response.json(
			await service.git.paths(worktree?.path ?? service.git.root),
		);
	};

	const addTodo = async (request: Request): Promise<Response> => {
		const form = await request.formData();
		const todo = await journal.record("todo add", null, async () =>
			todos.add(String(form.get("subject") ?? ""), null, {
				text: String(form.get("text") ?? ""),
				files: await uploads(form),
				position: positionIn(form),
				// Added from a lane's column, it goes at the bottom of that lane.
				lane: form.has("lane") ? laneIn(Number(form.get("lane"))) : null,
			}),
		);
		await tick();
		return Response.json(todo.state);
	};

	/** Where a todo write asks to put it; absent leaves it to the write. */
	const positionIn = (form: FormData): number | undefined =>
		form.has("position") ? Number(form.get("position")) : undefined;

	/** The todo a `/api/todos/<id>` path names, or `/api/todos/<id>/position`. */
	const todoAt = async (request: Request) => {
		const raw = new URL(request.url).pathname.split("/")[3] ?? "";
		const id = Number(raw);
		if (!Number.isInteger(id) || id <= 0) {
			fail("usage", `'${raw}' is not a todo id`, { todo: raw });
		}
		return todos.find(id);
	};

	const updateTodo = async (request: Request): Promise<Response> => {
		const form = await request.formData();
		const found = await todoAt(request);
		const todo = await journal.record("todo update", null, async () =>
			found.update({
				subject: form.has("subject") ? String(form.get("subject")) : undefined,
				text: form.has("text") ? String(form.get("text")) : undefined,
				position: positionIn(form),
				files: await uploads(form),
				keep: form.getAll("keep").map(String),
			}),
		);
		await tick();
		return Response.json(todo.state);
	};

	// Its own route, carrying nothing but the place, so a drag can never touch
	// a todo's words or files.
	const moveTodo = async (request: Request): Promise<Response> => {
		const found = await todoAt(request);
		const { position } = (await request.json()) as { position?: unknown };
		const todo = await journal.record("todo update", null, () =>
			found.update({ position: Number(position) }),
		);
		await tick();
		return Response.json(todo.state);
	};

	/** The JSON a write sends, as an object. */
	const body = async (request: Request): Promise<Record<string, unknown>> => {
		const read = (await request.json().catch(() => ({}))) as unknown;
		return typeof read === "object" && read !== null
			? (read as Record<string, unknown>)
			: {};
	};

	/** A lane as a write names it: a number, `"new"`, or null for none. */
	const laneIn = (value: unknown): number | "new" | null =>
		value === "new" || value === null ? value : Number(value);

	// What blocks it, all of it: the page sends the whole list, and
	// only the difference is linked or unlinked, so a loop is still refused.
	const linkTodo = async (request: Request): Promise<Response> => {
		const found = await todoAt(request);
		const { blockedBy } = await body(request);
		const ids = Array.isArray(blockedBy) ? blockedBy.map(Number) : [];
		const todo = await journal.record("todo update", null, () =>
			todos.link(found.id, {
				add: ids.filter((id) => !found.blockedBy.includes(id)),
				drop: found.blockedBy.filter((id) => !ids.includes(id)),
			}),
		);
		await tick();
		return Response.json(todo.state);
	};

	// Into a lane, or none, above the todo `before` or at the bottom of it.
	const arrangeTodo = async (request: Request): Promise<Response> => {
		const found = await todoAt(request);
		const { lane, before, name } = await body(request);
		const todo = await journal.record("todo update", null, () =>
			todos.arrange(found.id, laneIn(lane), {
				name: typeof name === "string" ? name : undefined,
				before:
					before === undefined || before === null ? undefined : Number(before),
			}),
		);
		await tick();
		return Response.json(todo.state);
	};

	/** The lane a `/api/lanes/<id>` path names. */
	const laneAt = (request: Request): number => {
		const raw = new URL(request.url).pathname.split("/")[3] ?? "";
		const id = Number(raw);
		if (!Number.isInteger(id) || id <= 0) {
			fail("usage", `'${raw}' is not a lane`, { lane: raw });
		}
		return id;
	};

	const joinLane = async (request: Request): Promise<Response> => {
		const from = laneAt(request);
		const { into } = await body(request);
		await journal.record("lane join", null, () =>
			todos.joinLanes(from, Number(into)),
		);
		await tick();
		return Response.json({ lane: Number(into) });
	};

	const addLane = async (request: Request): Promise<Response> => {
		const { name } = await body(request);
		const lane = await journal.record("lane add", null, () =>
			todos.addLane(String(name ?? "")),
		);
		await tick();
		return Response.json(lane);
	};

	const renameLane = async (request: Request): Promise<Response> => {
		const id = laneAt(request);
		const { name } = await body(request);
		const lane = await journal.record("lane update", null, () =>
			todos.renameLane(id, String(name ?? "")),
		);
		await tick();
		return Response.json(lane);
	};

	const dropLane = async (request: Request): Promise<Response> => {
		const id = laneAt(request);
		await journal.record("lane remove", null, () => todos.dropLane(id));
		await tick();
		return Response.json({ lane: id });
	};

	const removeTodo = async (request: Request): Promise<Response> => {
		const found = await todoAt(request);
		await journal.record("todo remove", null, () => found.remove());
		await tick();
		return Response.json(found.state);
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
			"/api/file": guarded(file),
			"/api/paths": guarded(paths),
			"/api/todos": { POST: guarded(addTodo) },
			"/api/todos/:id": {
				PATCH: guarded(updateTodo),
				DELETE: guarded(removeTodo),
			},
			"/api/todos/:id/position": { PUT: guarded(moveTodo) },
			"/api/todos/:id/blocked-by": { PUT: guarded(linkTodo) },
			"/api/todos/:id/lane": { PUT: guarded(arrangeTodo) },
			"/api/lanes/:id/join": { POST: guarded(joinLane) },
			"/api/lanes": { POST: guarded(addLane) },
			"/api/lanes/:id": { PUT: guarded(renameLane), DELETE: guarded(dropLane) },
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

/** How often the repo is re-read to decide whether open pages should refetch. */
const POLL_MS = 2_000;

/** The one address the server binds: this machine, and nothing else. */
const LOOPBACK = "127.0.0.1";

/** Names this machine answers to, which a page opened on it always may use. */
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

/** A phone photo fits; a stray video does not. */
const MAX_BODY_BYTES = 25 * 1024 * 1024;

/** The images a todo may hold, by extension, and how each is served. */
const IMAGE_TYPES: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	svg: "image/svg+xml",
};

/** How a refusal from the core reads over HTTP. */
const STATUS: Partial<Record<Reason, number>> = {
	usage: 400,
	not_found: 404,
	lease_held: 409,
	exists: 409,
	cycle: 409,
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

/** The files a form carries under `file`, as bytes. */
async function uploads(form: FormData): Promise<Attachment[]> {
	const files: Attachment[] = [];
	for (const file of form.getAll("file")) {
		if (file instanceof File) {
			files.push({
				name: file.name || "pasted",
				bytes: new Uint8Array(await file.arrayBuffer()),
			});
		}
	}
	return files;
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
