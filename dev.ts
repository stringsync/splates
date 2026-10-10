import { basename, dirname } from "node:path";
import {
	AsyncDisposer,
	type AsyncResource,
	type Resource,
} from "webappwiz/disposable";
import type { Logger } from "webappwiz/log";
import {
	type Fs,
	MAX_PORT,
	OpenPortProvider,
	type PortProvider,
	type Ps,
} from "webappwiz/system";
import { Debouncer, Duration, SystemTimer, Throttler } from "webappwiz/time";
import type { Attachment } from "./attachments";
import type { Answer, Conversations } from "./conversations";
import type { Assets } from "./dev/assets";
import { Exit, fail, type Reason } from "./exit";
import type { Format } from "./format";
import { PLAN_FILE } from "./plan";
import type { Projects } from "./projects";
import { openRepository, type Repository } from "./repository";
import { fingerprint, snapshot } from "./snapshot";

/** Preferred, not required: `dev` moves up from here when it is taken. */
export const DEFAULT_PORT = 4269;

/** How far above the port asked for `dev` will look before giving up. */
export const PORT_SPAN = 20;

/**
 * Serves what `todo list`, `list` and `show` print as one page that refetches
 * when the repo changes, where a person adds, edits, reorders and removes
 * todos. Anything that moves a task (merge, remove, claim) stays in the CLI,
 * so a page that should not have been reachable can at worst change a todo.
 *
 * Given `conversations`, the page also talks to agents, which run commands on
 * this machine. Those routes answer only to this machine's own names, never to
 * a host `hosts` lets in, so a tunnel still reaches no further than the todos.
 */
export async function dev(
	home: Project & { assets: Assets; projects: Projects },
	{
		ports = devPorts(DEFAULT_PORT),
		hosts = [],
		conversations: converse = null,
		open = async (root) => ({
			...home,
			...(await openRepository(home, { at: root, migrates: true })),
		}),
	}: DevOptions = {},
): Promise<DevServer> {
	const { fs, ps, log, assets, projects } = home;
	const allowed = new Set([...LOCAL_HOSTS, ...hosts]);
	// The page itself is a React app under `dev/`, built before publishing and
	// carried in the bundle, so nothing here builds markup and nothing reads it
	// off disk.
	const encoder = new TextEncoder();
	/** Where the agents' own `arbor` reaches this server, once it listens. */
	let url: string | null = null;

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

	// Refused, rather than missing, for any name but this machine's own: a
	// tunnel's visitor learns the feature exists, and nothing more.
	const local =
		(handle: (request: Request) => Promise<Response>) =>
		async (request: Request): Promise<Response> =>
			LOCAL_HOSTS.includes(hostname(request.headers.get("host") ?? ""))
				? handle(request)
				: refuse(
						403,
						"forbidden",
						"conversations run commands on this machine: open the page on it",
					);
	const talk = local;

	/**
	 * Everything one project's page talks to: its records, its stream of
	 * changes and its conversations, kept from the first request for it until
	 * the server stops.
	 */
	const serve = async ({
		service,
		journal,
		todos,
		format,
		arborDir,
	}: Project): Promise<Served> => {
		const read = () => snapshot({ service, todos, fs, home: ps.env("HOME") });
		const open = new Set<ReadableStreamDefaultController<Uint8Array>>();
		let last = fingerprint(await read());
		const conversations = converse?.({ arborDir }) ?? null;
		if (conversations !== null) {
			conversations.url = url;
		}

		// What a page shows is spread across arbor's records, the branches'
		// refs and each worktree's ARBOR.md, so all three are watched, and a
		// change anywhere in them reads the repo again to see what moved.
		const tick = async (): Promise<void> => {
			// Read only for a page that would hear of it. One that connects later
			// may hear of a change it already fetched, which costs it one refetch.
			if (open.size === 0) {
				return;
			}
			const now = await read();
			follow(now.tasks.map((task) => task.worktree));
			const print = fingerprint(now);
			if (print === last) {
				return;
			}
			last = print;
			for (const stream of open) {
				stream.enqueue(encoder.encode("data: changed\n\n"));
			}
		};
		// A write lands as a temp file renamed into place, and a merge moves
		// several things at once: one read once they settle covers them all.
		const settle = new Debouncer(new SystemTimer(), SETTLE);
		const changed = () =>
			settle.call(() => {
				tick().catch((error: unknown) => log.error(String(error)));
			});
		const gitDir = dirname(arborDir);
		const conversationsDir = `${arborDir}/conversations`;
		let watches: Resource[] = [];
		const trees = new Map<string, Resource>();
		let poll: ReturnType<typeof setInterval> | null = null;
		// Watched only while a page listens, the way the poll before it read.
		const arm = (): void => {
			try {
				watches = [
					fs.watch(
						arborDir,
						(path) => {
							// An agent's turn streams into its log: nothing a page shows.
							if (
								path !== conversationsDir &&
								!path.startsWith(`${conversationsDir}/`)
							) {
								changed();
							}
						},
						{ recursive: true },
					),
					fs.watch(`${gitDir}/refs`, changed, { recursive: true }),
					// Its own entries, of which only `packed-refs` names branches:
					// `index` moves on every `git status`.
					fs.watch(gitDir, (path) => {
						if (basename(path) === "packed-refs") {
							changed();
						}
					}),
				];
			} catch (error) {
				log.error(
					`arbor dev cannot watch ${service.git.root}, so it polls it: ${String(error)}`,
				);
				disarm();
				poll = setInterval(changed, POLL_MS);
			}
			changed();
		};
		const disarm = (): void => {
			for (const watch of [...watches, ...trees.values()]) {
				watch.dispose();
			}
			watches = [];
			trees.clear();
			settle.cancel();
			if (poll !== null) {
				clearInterval(poll);
				poll = null;
			}
		};
		/** Watches the ARBOR.md of each worktree in `paths`, and no other. */
		const follow = (paths: string[]): void => {
			if (open.size === 0 || poll !== null) {
				return;
			}
			for (const [path, watch] of trees) {
				if (!paths.includes(path)) {
					watch.dispose();
					trees.delete(path);
				}
			}
			for (const path of paths) {
				if (trees.has(path)) {
					continue;
				}
				try {
					trees.set(
						path,
						fs.watch(path, (file) => {
							if (basename(file) === PLAN_FILE) {
								changed();
							}
						}),
					);
				} catch {
					// Its worktree is gone: the task shows as orphaned, which no
					// longer moves.
				}
			}
		};

		const events = (): Response => {
			let self: ReadableStreamDefaultController<Uint8Array> | null = null;
			return new Response(
				new ReadableStream<Uint8Array>({
					start: (stream) => {
						self = stream;
						open.add(stream);
						if (open.size === 1) {
							arm();
						}
						// A comment, ignored by EventSource. Without a first chunk the
						// response headers never reach the client and the page hangs
						// waiting to connect.
						stream.enqueue(encoder.encode(": connected\n\n"));
					},
					cancel: () => {
						if (self) {
							open.delete(self);
						}
						if (open.size === 0) {
							disarm();
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
					...(type === undefined
						? { "content-disposition": "attachment" }
						: {}),
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
					subject: form.has("subject")
						? String(form.get("subject"))
						: undefined,
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
						before === undefined || before === null
							? undefined
							: Number(before),
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

		// A new name, a new place among the lanes, or both.
		const updateLane = async (request: Request): Promise<Response> => {
			const id = laneAt(request);
			const { name, position } = await body(request);
			const lane = await journal.record("lane update", null, async () => {
				const renamed =
					name === undefined
						? undefined
						: await todos.renameLane(id, String(name));
				const order =
					position === undefined
						? undefined
						: await todos.moveLane(id, Number(position));
				return order?.find((each) => each.id === id) ?? renamed;
			});
			await tick();
			return Response.json(lane ?? { id });
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

		/** The conversations a page may hold, or a refusal when they are off. */
		const held = (): Conversations => {
			if (conversations === null) {
				fail(
					"not_found",
					"conversations are off: run `arbor dev --experimental`",
					{},
				);
			}
			return conversations;
		};

		/** The conversation a `/api/conversations/<id>` path names. */
		const conversationAt = (request: Request) =>
			held().find(new URL(request.url).pathname.split("/")[3] ?? "");

		const listConversations = async (): Promise<Response> => {
			const all = held();
			return Response.json({
				agents: all.agents.map(({ id, name }) => ({ id, name })),
				conversations: (await all.list()).map((each) => each.state),
			});
		};

		/** Where a conversation for `task` runs: its worktree, or the main tree. */
		const treeFor = async (task: unknown): Promise<[string | null, string]> => {
			const named = typeof task === "string" && task !== "" ? task : null;
			const worktree = named === null ? null : await service.find(named);
			if (worktree !== null && !worktree.exists) {
				fail("not_found", `no worktree for '${named}'`, { task: named });
			}
			return [named, worktree?.path ?? service.git.root];
		};

		const startConversation = async (request: Request): Promise<Response> => {
			const { agent, task, settings } = await body(request);
			const [named, cwd] = await treeFor(task);
			const conversation = await held().start(String(agent ?? ""), {
				task: named,
				cwd,
				settings: Object.fromEntries(
					Object.entries(
						typeof settings === "object" && settings !== null ? settings : {},
					).map(([id, value]) => [id, String(value)]),
				),
			});
			return Response.json(conversation.state);
		};

		// The agent's own `arbor` sends this as it takes or lands a task. `from`
		// names the task it is leaving, so removing some other task moves nothing.
		const moveConversation = async (request: Request): Promise<Response> => {
			const conversation = await conversationAt(request);
			const { task, from } = await body(request);
			const [named, cwd] = await treeFor(task);
			if (from === undefined || from === conversation.state.task) {
				conversation.move(named, cwd);
			}
			return Response.json(conversation.state);
		};

		const promptConversation = async (request: Request): Promise<Response> => {
			const conversation = await conversationAt(request);
			const { text } = await body(request);
			await conversation.prompt(String(text ?? ""));
			return Response.json(conversation.state);
		};

		const answerConversation = async (request: Request): Promise<Response> => {
			const conversation = await conversationAt(request);
			const { ask, answer } = await body(request);
			conversation.answer(String(ask ?? ""), answer as Answer);
			return Response.json(conversation.state);
		};

		const cancelConversation = async (request: Request): Promise<Response> => {
			const conversation = await conversationAt(request);
			await conversation.cancel();
			return Response.json(conversation.state);
		};

		const chooseSetting = async (request: Request): Promise<Response> => {
			const conversation = await conversationAt(request);
			const { id, value } = await body(request);
			await conversation.choose(String(id ?? ""), String(value ?? ""));
			return Response.json(conversation.state);
		};

		const renameConversation = async (request: Request): Promise<Response> => {
			const conversation = await conversationAt(request);
			const { name } = await body(request);
			await conversation.rename(String(name ?? ""));
			return Response.json(conversation.state);
		};

		const archiveConversation = async (request: Request): Promise<Response> => {
			const conversation = await conversationAt(request);
			const { archived } = await body(request);
			await (archived === false
				? conversation.unarchive()
				: conversation.archive());
			return Response.json(conversation.state);
		};

		// Each change carries the whole conversation, since an agent streams in
		// small pieces and a page refetching after each would fall behind. At most
		// one per conversation per beat, the latest, which holds everything before.
		const listeners = new Set<ReadableStreamDefaultController<Uint8Array>>();
		const beats = new Map<string, Throttler>();
		const timer = new SystemTimer();
		const unlisten = conversations?.events.on("changed", (id) => {
			const beat = beats.get(id) ?? new Throttler(timer, BEAT);
			beats.set(id, beat);
			beat.call(async () => {
				const state = (await conversations.find(id)).state;
				const chunk = encoder.encode(`data: ${JSON.stringify(state)}\n\n`);
				for (const stream of listeners) {
					stream.enqueue(chunk);
				}
			});
		});
		const conversationEvents = async (): Promise<Response> => {
			held();
			let self: ReadableStreamDefaultController<Uint8Array> | null = null;
			return new Response(
				new ReadableStream<Uint8Array>({
					start: (stream) => {
						self = stream;
						listeners.add(stream);
						stream.enqueue(encoder.encode(": connected\n\n"));
					},
					cancel: () => {
						if (self) {
							listeners.delete(self);
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

		return {
			root: service.git.root,
			format,
			conversations,
			snapshot: async () => Response.json(await read()),
			events: async () => events(),
			file,
			paths,
			addTodo,
			updateTodo,
			moveTodo,
			linkTodo,
			arrangeTodo,
			joinLane,
			addLane,
			updateLane,
			dropLane,
			removeTodo,
			listConversations,
			startConversation,
			moveConversation,
			promptConversation,
			answerConversation,
			cancelConversation,
			chooseSetting,
			renameConversation,
			archiveConversation,
			conversationEvents,
			async disposeAsync() {
				disarm();
				unlisten?.();
				for (const beat of beats.values()) {
					beat.dispose();
				}
				await conversations?.disposeAsync();
			},
		};
	};

	// By root, each opened on its first request: the one `arbor dev` started
	// in at once, every other registered one only when a page asks for it.
	const served = new Map<string, Promise<Served>>();
	const here = home.service.git.root;
	const servedAt = (root: string): Promise<Served> => {
		let found = served.get(root);
		if (found === undefined) {
			found = (root === here ? Promise.resolve(home) : open(root)).then(serve);
			// One that failed to open is tried again on the next request.
			found.catch(() => served.delete(root));
			served.set(root, found);
		}
		return found;
	};

	/** The project a request names with `?project=`, or the one started in. */
	const projectFor = async (request: Request): Promise<Served> => {
		const slug = new URL(request.url).searchParams.get("project") ?? "";
		if (slug === "") {
			return servedAt(here);
		}
		const found = (await projects.list()).find((each) => each.slug === slug);
		if (found === undefined) {
			fail("not_found", `no arbor project '${slug}'`, { project: slug });
		}
		if (found.gone) {
			fail("not_found", `${found.root} is gone: moved or deleted`, {
				project: slug,
			});
		}
		return servedAt(found.root);
	};

	// Again on every request, since a newer arbor may have migrated the
	// records since this server started.
	const scoped =
		(pick: (project: Served) => Handler) =>
		(request: Request): Promise<Response> =>
			guarded(async (request) => {
				const project = await projectFor(request);
				await project.format.check();
				return pick(project)(request);
			})(request);

	// A conversation is the project's it started in, whichever the page is on:
	// the agent's own `arbor` names no project when it says it moved.
	const owned =
		(pick: (project: Served) => Handler) =>
		(request: Request): Promise<Response> =>
			guarded(async (request) => {
				const id = new URL(request.url).pathname.split("/")[3] ?? "";
				let owner: Served | null = null;
				for (const settled of await Promise.allSettled(served.values())) {
					const project = settled.status === "fulfilled" ? settled.value : null;
					if (
						project?.conversations &&
						(await project.conversations.find(id).then(
							() => true,
							() => false,
						))
					) {
						owner = project;
						break;
					}
				}
				// None holds it: the project asked for refuses it, as ever.
				const project = owner ?? (await projectFor(request));
				await project.format.check();
				return pick(project)(request);
			})(request);

	const listProjects = async (): Promise<Response> =>
		Response.json({
			projects: (await projects.list()).map((each) => ({
				...each,
				here: each.root === here,
			})),
		});

	const forgetProject = async (request: Request): Promise<Response> => {
		const slug = new URL(request.url).pathname.split("/")[3] ?? "";
		const found = (await projects.list()).find((each) => each.slug === slug);
		if (found === undefined) {
			fail("not_found", `no arbor project '${slug}'`, { project: slug });
		}
		if (found.root === here) {
			fail("usage", `arbor dev runs in ${slug}: it cannot forget it`, {
				project: slug,
			});
		}
		await projects.forget(found.root);
		return Response.json(found);
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
			"/api/projects": guarded(listProjects),
			"/api/projects/:slug": { DELETE: guarded(forgetProject) },
			"/api/snapshot": scoped((project) => project.snapshot),
			"/api/file": scoped((project) => project.file),
			"/api/paths": scoped((project) => project.paths),
			"/api/todos": { POST: scoped((project) => project.addTodo) },
			"/api/todos/:id": {
				PATCH: scoped((project) => project.updateTodo),
				DELETE: scoped((project) => project.removeTodo),
			},
			"/api/todos/:id/position": { PUT: scoped((project) => project.moveTodo) },
			"/api/todos/:id/blocked-by": {
				PUT: scoped((project) => project.linkTodo),
			},
			"/api/todos/:id/lane": { PUT: scoped((project) => project.arrangeTodo) },
			"/api/lanes/:id/join": { POST: scoped((project) => project.joinLane) },
			"/api/lanes": { POST: scoped((project) => project.addLane) },
			"/api/lanes/:id": {
				PUT: scoped((project) => project.updateLane),
				DELETE: scoped((project) => project.dropLane),
			},
			"/events": scoped((project) => project.events),
			"/api/conversations": {
				GET: talk(scoped((project) => project.listConversations)),
				POST: talk(scoped((project) => project.startConversation)),
			},
			"/api/conversations/events": talk(
				scoped((project) => project.conversationEvents),
			),
			"/api/conversations/:id/prompt": {
				POST: talk(owned((project) => project.promptConversation)),
			},
			"/api/conversations/:id/answer": {
				POST: talk(owned((project) => project.answerConversation)),
			},
			"/api/conversations/:id/cancel": {
				POST: talk(owned((project) => project.cancelConversation)),
			},
			"/api/conversations/:id/setting": {
				PUT: talk(owned((project) => project.chooseSetting)),
			},
			"/api/conversations/:id/archived": {
				PUT: talk(owned((project) => project.archiveConversation)),
			},
			"/api/conversations/:id/name": {
				PUT: talk(owned((project) => project.renameConversation)),
			},
			"/api/conversations/:id/task": {
				PUT: talk(owned((project) => project.moveConversation)),
			},
		},
		fetch: () => new Response("not found", { status: 404 }),
	});
	// Read back, because `ports` may hand over 0 to mean any port at all, and
	// read now, because `server.port` is 0 once the server is stopped and this is
	// handed to a caller that stops it. Undefined only for a unix socket, which
	// this never asks for.
	const port = server.port ?? requested;
	url = `http://localhost:${port}`;
	// Open now, so the page's first request finds it ready.
	await servedAt(here);

	log.info(`arbor dev on http://localhost:${port}`);
	const disposer = new AsyncDisposer();
	// true drains open connections rather than cutting them mid-response
	disposer.defer(() => server.stop(true));
	disposer.defer(async () => {
		for (const settled of await Promise.allSettled(served.values())) {
			if (settled.status === "fulfilled") {
				await settled.value.disposeAsync();
			}
		}
	});
	return {
		port,
		disposeAsync: disposer.disposeAsync,
	};
}

/** How often an open page hears about one conversation while its agent streams. */
const BEAT = Duration.ms(50);

/**
 * How often a repo that cannot be watched is re-read to decide whether open
 * pages should refetch.
 */
const POLL_MS = 2_000;

/** How long changes to a repo's files settle before it is read again. */
const SETTLE = Duration.ms(50);

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
	outdated: 409,
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
	/**
	 * Makes the conversations a project's page may hold with agents, its
	 * records in `arborDir`; without it no page has any to show, and the routes
	 * say they are off.
	 */
	conversations?: ((project: { arborDir: string }) => Conversations) | null;
	/** Opens a registered project other than the one started in, by its root. */
	open?: (root: string) => Promise<Project>;
}

/** What `dev` serves a project with: its own records, read and written. */
export type Project = Pick<
	Repository,
	"service" | "journal" | "todos" | "format" | "arborDir"
> & { fs: Fs; ps: Ps; log: Logger };

/** A route's work once its project is known. */
type Handler = (request: Request) => Promise<Response>;

/** One project as the server holds it: what each of its routes does. */
interface Served extends AsyncResource {
	root: string;
	format: Format;
	conversations: Conversations | null;
	snapshot: Handler;
	events: Handler;
	file: Handler;
	paths: Handler;
	addTodo: Handler;
	updateTodo: Handler;
	moveTodo: Handler;
	linkTodo: Handler;
	arrangeTodo: Handler;
	joinLane: Handler;
	addLane: Handler;
	updateLane: Handler;
	dropLane: Handler;
	removeTodo: Handler;
	listConversations: Handler;
	startConversation: Handler;
	moveConversation: Handler;
	promptConversation: Handler;
	answerConversation: Handler;
	cancelConversation: Handler;
	chooseSetting: Handler;
	renameConversation: Handler;
	archiveConversation: Handler;
	conversationEvents: Handler;
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
