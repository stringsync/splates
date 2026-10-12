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
import { z } from "zod";
import type { Attachment } from "./attachments";
import type {
	After,
	Answer,
	Checkpoint,
	Conversation,
	ConversationState,
	Conversations,
} from "./conversations";
import type { Assets } from "./dev/assets";
import { startDispatched } from "./dispatched";
import { Exit, fail, type Reason } from "./exit";
import type { Format } from "./format";
import type { Git } from "./git";
import { needs } from "./needs";
import { PLAN_FILE } from "./plan";
import type { Projects } from "./projects";
import { RESUME } from "./prompts";
import { Pty } from "./pty";
import { isNewer, type Release, RUNNING } from "./release";
import { openRepository, type Repository } from "./repository";
import { grantRetry } from "./retry";
import { type AgentPick, modelsOf, pickAgent } from "./roster";
import type { Details } from "./show";
import { fingerprint, snapshot, tasksOf } from "./snapshot";
import { RESTART, UPDATE } from "./supervise";

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
		shell = null,
		newest = async () => null,
		running = RUNNING,
		checkEvery = CHECK,
		exit = null,
		open = async (root) => ({
			...home,
			...(await openRepository(home, { at: root, migrates: true })),
		}),
	}: DevOptions = {},
): Promise<DevServer> {
	const { fs, ps, log, assets, projects } = home;
	const here = home.service.git.root;
	// The page lists and switches between registered projects only, so one
	// that is not would be served but never named.
	if (!(await projects.list()).some((each) => each.root === here)) {
		fail(
			"uninitialized",
			[
				`${here} is not registered as an arbor project.`,
				"Run `arbor init` in it once, then `arbor dev` again.",
			].join("\n"),
			{ root: here },
		);
	}
	const allowed = new Set([...LOCAL_HOSTS, ...hosts]);
	// The page itself is a React app under `dev/`, built before publishing and
	// carried in the bundle, so nothing here builds markup and nothing reads it
	// off disk.
	const encoder = new TextEncoder();
	/** Where the agents' own `arbor` reaches this server, once it listens. */
	let url: string | null = null;
	/** A newer arbor on npm, once a check has found one; every page says so. */
	let release: Release | null = null;
	/**
	 * The restart to follow the checkpoint under way, once every agent has
	 * answered, and whether the next run resumes them; null for none.
	 */
	let restarting: { resume: boolean } | null = null;
	/**
	 * How this run began, when a checkpoint's restart started it: its agents
	 * `waiting` to be resumed, until the checkpoint ends or another is asked
	 * for, or `resuming`, told to carry on, until each has.
	 */
	let restarted: "waiting" | "resuming" | null = null;
	/** This run of `arbor dev`, so a page can tell it has restarted. */
	const run = crypto.randomUUID();
	/**
	 * Written by a checkpoint's restart, beside the registry, with the other
	 * projects whose agents it stopped, so the next run opens them at once,
	 * and whether it resumes them.
	 */
	const reopen = `${projects.path.slice(0, projects.path.lastIndexOf("/"))}/restart.json`;

	const asset = (body: string, type: string): Response =>
		new Response(body, { headers: { "content-type": type } });

	// Every route that reads or writes the repo goes through here. The Host
	// check is what DNS rebinding runs into; the Origin check is what a form on
	// another site posting to this one runs into. A handler that upgrades the
	// connection answers nothing, and that passes through too.
	const guarded =
		<Answered extends Response | undefined>(
			handle: (request: Request) => Promise<Answered>,
		) =>
		async (request: Request): Promise<Answered | Response> => {
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
		<Answered extends Response | undefined>(
			handle: (request: Request) => Promise<Answered>,
		) =>
		async (request: Request): Promise<Answered | Response> =>
			LOCAL_HOSTS.includes(hostname(request.headers.get("host") ?? ""))
				? handle(request)
				: refuse(
						403,
						"forbidden",
						"conversations and terminals run commands on this machine: open the page on it",
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
		git,
	}: Project): Promise<Served> => {
		const read = () =>
			snapshot({ service, todos, fs, home: ps.env("HOME"), release });
		const open = new Set<ReadableStreamDefaultController<Uint8Array>>();
		let last = fingerprint(await read());
		const conversations = converse?.({ arborDir, git }) ?? null;
		// A task `arbor add --agent` handed to an agent starts it, whether or
		// not a page listens, so its records are watched all along. One run at
		// a time, so none starts a task the run before it is starting.
		let handOffs: Resource | null = null;
		if (conversations !== null) {
			conversations.url = url;
			let starting = Promise.resolve();
			const handOff = (): void => {
				starting = starting
					.then(() => startDispatched({ service, conversations, log }))
					.catch((error: unknown) => log.error(String(error)));
			};
			const settled = new Debouncer(new SystemTimer(), SETTLE);
			try {
				const watch = fs.watch(`${arborDir}/tasks`, () =>
					settled.call(handOff),
				);
				handOffs = {
					dispose: () => {
						watch.dispose();
						settled.cancel();
					},
				};
			} catch (error) {
				log.error(
					`arbor dev cannot watch ${service.git.root}'s tasks, so it starts a task handed to an agent only as it starts: ${String(error)}`,
				);
			}
			handOff();
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

		// Only a file a todo or a task holds, so the page, and whoever a tunnel
		// lets reach it, can read nothing on this machine that was not put there
		// on purpose.
		const file = async (request: Request): Promise<Response> => {
			const params = new URL(request.url).searchParams;
			const path = params.get("path") ?? "";
			const type = MEDIA_TYPES[path.split(".").at(-1)?.toLowerCase() ?? ""];
			const bytes =
				todos.owns(path) || service.owns(path)
					? await fs.readBytes(path).catch(() => null)
					: null;
			if (bytes === null) {
				return refuse(404, "not_found", `nothing here shows ${path}`);
			}
			// Safari plays a video only from a server that hands out its parts.
			const range = /^bytes=(\d*)-(\d*)$/.exec(
				request.headers.get("range") ?? "",
			);
			const start = range?.[1] ? Number(range[1]) : null;
			const end = range?.[2] ? Number(range[2]) : null;
			const first =
				start ?? (end === null ? 0 : Math.max(bytes.length - end, 0));
			const last =
				start !== null && end !== null
					? Math.min(end, bytes.length - 1)
					: bytes.length - 1;
			const partial = range !== null && first <= last;
			const body = partial ? bytes.subarray(first, last + 1) : bytes;
			return new Response(new Blob([body as Uint8Array<ArrayBuffer>]), {
				status: partial ? 206 : 200,
				headers: {
					"content-type": type ?? "application/octet-stream",
					"accept-ranges": "bytes",
					...(partial
						? { "content-range": `bytes ${first}-${last}/${bytes.length}` }
						: {}),
					// Anything not an image or a recording downloads rather than rendering here.
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

		// What a task changed against its base, for its review in the page.
		const diff = async (request: Request): Promise<Response> => {
			const task = decodeURIComponent(
				new URL(request.url).pathname.split("/")[3] ?? "",
			);
			const worktree = await service.find(task);
			const files = worktree.hasBranch ? await worktree.diff() : null;
			if (files === null) {
				fail("not_found", `no branch for '${task}'`, { task });
			}
			return Response.json(files);
		};

		// `arbor retry` from the page: another round of merge attempts for a
		// task escalated once it spent its own.
		const retryTask = async (request: Request): Promise<Response> => {
			const task = decodeURIComponent(
				new URL(request.url).pathname.split("/")[3] ?? "",
			);
			const worktree = await journal.record("retry", task, () =>
				grantRetry(service, task),
			);
			await tick();
			return Response.json(worktree.state);
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

		/**
		 * The agent a body names, `{ agent, model }`, off the roster the page's
		 * conversations start from; null for `{ agent: null }`, for none.
		 */
		const assigneeIn = async (request: Request): Promise<AgentPick | null> => {
			const { agent, model } = await body(request);
			if (agent === null || agent === undefined || agent === "") {
				return null;
			}
			return pickAgent(
				held().agents.map((each) => ({ ...each, models: modelsOf(each) })),
				String(agent),
				model === null || model === undefined || model === ""
					? undefined
					: String(model),
			);
		};

		const assignTodo = async (request: Request): Promise<Response> => {
			const found = await todoAt(request);
			const assignee = await assigneeIn(request);
			const todo = await journal.record("todo update", null, () =>
				found.update({ assignee }),
			);
			await tick();
			return Response.json(todo.state);
		};

		const assignLane = async (request: Request): Promise<Response> => {
			const id = laneAt(request);
			const assignee = await assigneeIn(request);
			const lane = await journal.record("lane update", null, () =>
				todos.assignLane(id, assignee),
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

		/** The conversations a page may hold, or a refusal when they are off. */
		const held = (): Conversations => {
			if (conversations === null) {
				fail("not_found", "conversations are off", {});
			}
			return conversations;
		};

		/**
		 * Asks every live conversation for a checkpoint, or only those `only`
		 * names by id, without waiting on the agents: one whose task is merging
		 * gets to finish the merge first. While one is still asked, the
		 * checkpoint under way stands, and nothing is asked again. Answers with
		 * what settles as each asked answers.
		 */
		const checkpoint = async (only?: string[]): Promise<Promise<void>[]> => {
			const all = (await conversations?.list()) ?? [];
			if (all.some((each) => each.state.checkpoint === "asked")) {
				return [];
			}
			const asked: Promise<void>[] = [];
			for (const conversation of all) {
				if (only !== undefined && !only.includes(conversation.id)) {
					continue;
				}
				// What the last one said goes, so this one lists only its own.
				conversation.dismissCheckpoint();
				const { task, status } = conversation.state;
				if (status === "stopped" || status === "failed") {
					continue;
				}
				const worktree = task === null ? null : await service.find(task);
				asked.push(
					conversation
						.checkpoint(worktree?.status === "merging")
						.catch(() => {})
						.then(() => conversation.answered()),
				);
			}
			return asked;
		};

		/** The conversation a `/api/conversations/<id>` path names. */
		const conversationAt = (request: Request) =>
			held().find(new URL(request.url).pathname.split("/")[3] ?? "");

		const listConversations = async (): Promise<Response> => {
			const all = held();
			const offered = await all.settings();
			return Response.json({
				agents: all.agents.map((each) => ({
					id: each.id,
					name: each.name,
					models: modelsOf(each).map(({ id, name }) => ({ id, name })),
					settings: offered[each.id] ?? [],
				})),
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

		/** The tree a terminal opens in: `?task=`'s worktree, or the main tree. */
		const terminalTree = async (request: Request): Promise<string> => {
			const [, cwd] = await treeFor(
				new URL(request.url).searchParams.get("task"),
			);
			return cwd;
		};

		const startConversation = async (request: Request): Promise<Response> => {
			const { agent, task, settings, model } = await body(request);
			const [named, cwd] = await treeFor(task);
			const conversation = await held().start(String(agent ?? ""), {
				task: named,
				cwd,
				model: typeof model === "string" && model !== "" ? model : undefined,
				settings: Object.fromEntries(
					Object.entries(
						typeof settings === "object" && settings !== null ? settings : {},
					).map(([id, value]) => [id, String(value)]),
				),
			});
			return Response.json(conversation.state);
		};

		/**
		 * The sessions the agents hold in `?task=`'s tree that no conversation
		 * does, such as ones started in their CLI, to bring in.
		 */
		const listSessions = async (request: Request): Promise<Response> => {
			const [, cwd] = await treeFor(
				new URL(request.url).searchParams.get("task"),
			);
			return Response.json(await held().sessions(cwd));
		};

		/** Brings in a session an agent holds, as a conversation in `task`'s tree. */
		const bringSession = async (request: Request): Promise<Response> => {
			const { agent, session, task, title } = await body(request);
			const [named, cwd] = await treeFor(task);
			const conversation = await held().bring(
				String(agent ?? ""),
				String(session ?? ""),
				{
					task: named,
					cwd,
					title: typeof title === "string" && title !== "" ? title : null,
				},
			);
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
			const { text, images } = await body(request);
			await conversation.prompt(
				String(text ?? ""),
				(Array.isArray(images) ? images : []).map((each) => ({
					mimeType: String(each?.mimeType ?? ""),
					data: String(each?.data ?? ""),
				})),
			);
			return Response.json(conversation.state);
		};

		// Only an image the person sent in it, by the name its message gives.
		const conversationImage = async (request: Request): Promise<Response> => {
			const conversation = await conversationAt(request);
			const name = new URL(request.url).pathname.split("/")[5] ?? "";
			const image = await conversation.image(decodeURIComponent(name));
			if (image === null) {
				return refuse(
					404,
					"not_found",
					`conversation ${conversation.id} sent no image ${name}`,
				);
			}
			return new Response(new Blob([image.bytes as Uint8Array<ArrayBuffer>]), {
				headers: {
					"content-type": image.mimeType,
					// Named for what is in it, so it never changes.
					"cache-control": "private, max-age=31536000, immutable",
					"x-content-type-options": "nosniff",
				},
			});
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

		/** Forgets the checkpoint here, so the next click starts a new one. */
		const dismissCheckpoint = async (): Promise<Response> => {
			restarting = null;
			restarted = null;
			for (const conversation of await held().list()) {
				conversation.dismissCheckpoint();
			}
			return Response.json({});
		};

		const unqueueConversation = async (request: Request): Promise<Response> => {
			const conversation = await conversationAt(request);
			const { index } = await body(request);
			return Response.json(conversation.unqueue(Number(index ?? -1)));
		};

		const sendQueuedNow = async (request: Request): Promise<Response> => {
			const conversation = await conversationAt(request);
			await conversation.sendNow();
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

		const markUnread = async (request: Request): Promise<Response> => {
			const conversation = await conversationAt(request);
			const { unread } = await body(request);
			await conversation.markUnread(unread === true);
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
		const send = (chunk: Uint8Array): void => {
			for (const stream of listeners) {
				stream.enqueue(chunk);
			}
		};
		const unlisten = conversations?.events.on("changed", (id) => {
			const beat = beats.get(id) ?? new Throttler(timer, BEAT);
			beats.set(id, beat);
			beat.call(async () => {
				// Gone meanwhile, deleted as an older archived one: `removed` says so.
				const state = (await conversations.list()).find(
					(each) => each.id === id,
				)?.state;
				if (state !== undefined) {
					send(encoder.encode(`data: ${JSON.stringify(state)}\n\n`));
				}
			});
		});
		// An older archived conversation, deleted: the page drops it.
		const unlistenRemoved = conversations?.events.on("removed", (id) => {
			beats.get(id)?.dispose();
			beats.delete(id);
			send(encoder.encode(`event: removed\ndata: ${id}\n\n`));
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
			refresh: changed,
			snapshot: async () => Response.json(await read()),
			waiting: async () =>
				waitingOn(
					await tasksOf({ service, fs }),
					((await conversations?.list()) ?? []).map(({ state }) => state),
				),
			events: async () => events(),
			file,
			paths,
			diff,
			retryTask,
			addTodo,
			updateTodo,
			moveTodo,
			linkTodo,
			arrangeTodo,
			assignTodo,
			assignLane,
			joinLane,
			addLane,
			updateLane,
			dropLane,
			removeTodo,
			listConversations,
			startConversation,
			listSessions,
			bringSession,
			checkpoint,
			moveConversation,
			promptConversation,
			conversationImage,
			answerConversation,
			cancelConversation,
			dismissCheckpoint,
			unqueueConversation,
			sendQueuedNow,
			chooseSetting,
			renameConversation,
			markUnread,
			archiveConversation,
			conversationEvents,
			terminalTree,
			async disposeAsync() {
				disarm();
				handOffs?.dispose();
				unlisten?.();
				unlistenRemoved?.();
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
	const projectFor = (request: Request): Promise<Served> =>
		projectNamed(new URL(request.url).searchParams.get("project") ?? "");

	/** The project `slug` names, or the one started in for none. */
	const projectNamed = async (slug: string): Promise<Served> => {
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

	// Every shell a page has open, so stopping the server hangs up on them all.
	const shells = new Set<Pty>();

	// A shell runs anything typed at it, so it gets the conversations' rule (this
	// machine's own names only) and an Origin check of its own: an upgrade is a
	// GET, which `guarded` lets through from anywhere, and without the check any
	// site the person visits could open a shell here.
	const openTerminal = (request: Request, server: Bun.Server<TerminalData>) =>
		talk(
			guarded(async (request): Promise<Response | undefined> => {
				const host = request.headers.get("host") ?? "";
				const origin = URL.parse(request.headers.get("origin") ?? "");
				if (origin === null || origin.host !== host) {
					return refuse(
						403,
						"forbidden",
						"a terminal opens only from its own page",
					);
				}
				if (shell === null) {
					fail("not_found", "terminals are off", {});
				}
				const project = await projectFor(request);
				await project.format.check();
				const cwd = await project.terminalTree(request);
				const params = new URL(request.url).searchParams;
				const data = {
					cwd,
					cols: dimension(params.get("cols"), 80),
					rows: dimension(params.get("rows"), 24),
					pty: null,
				};
				// Bun answers an upgrade itself, so there is nothing to return.
				return server.upgrade(request, { data })
					? undefined
					: refuse(400, "usage", "a terminal is a WebSocket: connect with one");
			}),
		)(request);

	// Each with the conversations a checkpoint would ask, or has asked, in
	// it: only those of a project this server has opened, since one not yet
	// opened has none running. And with how many agents wait on the person
	// there. Says whether a restart is to follow the checkpoint, and which run
	// this is, for the page to see it come back.
	const listProjects = async (): Promise<Response> => {
		if (restarted === "resuming" && (await checkpointed()).length === 0) {
			restarted = null;
		}
		return Response.json({
			projects: await Promise.all(
				(await projects.list()).map(async (each) => ({
					...each,
					here: each.root === here,
					conversations: await checkpointable(each.root),
					waiting: each.gone ? 0 : await waitingIn(each.root),
				})),
			),
			restarting,
			restarted,
			run,
			running,
			newest: release?.newest ?? null,
		});
	};
	const checkpointable = async (root: string) => {
		const project = await served.get(root)?.catch(() => null);
		return ((await project?.conversations?.list()) ?? [])
			.map(({ state }) => state)
			.filter(
				(state) =>
					state.checkpoint !== null ||
					(state.status !== "stopped" && state.status !== "failed"),
			)
			.map(({ id, name, lastTask, title, agent, status, checkpoint }) => ({
				id,
				name: name ?? lastTask ?? title ?? agent,
				status,
				checkpoint,
			}));
	};

	// Projects read for their tasks alone, by root: opened, never served, so
	// listing them starts none of their agents.
	const peeked = new Map<string, Promise<Project>>();
	// A served project counts its own; one not is read for its tasks alone,
	// where only an external agent can be at work.
	const waitingIn = async (root: string): Promise<number> => {
		const project = await served.get(root)?.catch(() => null);
		if (project) {
			return project.waiting();
		}
		let found = peeked.get(root);
		if (found === undefined) {
			found = open(root);
			found.catch(() => peeked.delete(root));
			peeked.set(root, found);
		}
		const opened = await found.catch(() => null);
		return opened === null ? 0 : waitingOn(await tasksOf(opened), []);
	};

	// Read when the page opens its hint, so the conversations it lists are the
	// ones a restart would stop right then.
	const showRelease = async (): Promise<Response> => {
		const interrupted: {
			project: string;
			id: string;
			name: string;
			status: string;
			checkpoint: Checkpoint | null;
		}[] = [];
		const slugs = new Map(
			(await projects.list()).map((each) => [each.root, each.slug]),
		);
		for (const settled of await Promise.allSettled(served.values())) {
			const project = settled.status === "fulfilled" ? settled.value : null;
			for (const conversation of (await project?.conversations?.list()) ?? []) {
				const { id, name, lastTask, title, agent, status } = conversation.state;
				// An idle one loses its agent too, even with no turn to cut off.
				if (status !== "stopped" && status !== "failed") {
					interrupted.push({
						project: slugs.get(project?.root ?? "") ?? "",
						id,
						name: name ?? lastTask ?? title ?? agent,
						status,
						checkpoint: conversation.state.checkpoint,
					});
				}
			}
		}
		return Response.json({
			running,
			newest: release?.newest ?? null,
			interrupted,
		});
	};

	/** Asks every live conversation in every project for a checkpoint. */
	const checkpointAll = async (): Promise<void> => {
		for (const settled of await Promise.allSettled(served.values())) {
			if (settled.status === "fulfilled") {
				await settled.value.checkpoint();
			}
		}
	};

	/**
	 * Restarts `arbor dev` once each checkpoint `asked` has been answered,
	 * unless dismissed meanwhile.
	 */
	const restartAfter = (asked: Promise<void>[], resume: boolean): void => {
		restarting = { resume };
		void Promise.all(asked).then(async () => {
			if (restarting === null) {
				return;
			}
			const roots: string[] = [];
			for (const [root, opened] of served) {
				const project = await opened.catch(() => null);
				const all = (await project?.conversations?.list()) ?? [];
				if (root !== here && all.some((each) => each.stoppedByCheckpoint)) {
					roots.push(root);
				}
			}
			await fs.write(reopen, `${JSON.stringify({ roots, resume })}\n`);
			const code = release === null ? RESTART : UPDATE;
			log.info(
				release === null
					? "arbor dev restarting"
					: `arbor dev restarting on arbor ${release.newest}`,
			);
			await disposer.disposeAsync();
			exit?.(code);
		});
	};

	/**
	 * Asks every live conversation in each project `projects` names, by slug,
	 * for a checkpoint, then does what `after` says. A restart waits on all of
	 * them, and stops other projects' agents as they are.
	 */
	const checkpointProjects = async (request: Request): Promise<Response> => {
		const read = (await request.json().catch(() => ({}))) as {
			projects?: unknown;
			after?: unknown;
			conversations?: unknown;
		};
		const slugs = Array.isArray(read.projects) ? read.projects.map(String) : [];
		if (slugs.length === 0) {
			fail("usage", "name a project to checkpoint", {});
		}
		const after: After =
			read.after === "restart" || read.after === "resume" ? read.after : "stop";
		const only = Array.isArray(read.conversations)
			? read.conversations.map(String)
			: undefined;
		if (after !== "stop" && exit === null) {
			fail("usage", "arbor dev cannot restart itself here: restart it", {});
		}
		const chosen = await Promise.all(slugs.map(projectNamed));
		restarted = null;
		const asked: Promise<void>[] = [];
		for (const project of chosen) {
			asked.push(...(await project.checkpoint(only)));
		}
		if (after !== "stop") {
			restartAfter(asked, after === "resume");
		}
		return Response.json({});
	};

	/** Each conversation a checkpoint has asked, in every project. */
	const checkpointed = async (): Promise<Conversation[]> => {
		const all: Conversation[] = [];
		for (const settled of await Promise.allSettled(served.values())) {
			if (settled.status === "fulfilled") {
				for (const each of (await settled.value.conversations?.list()) ?? []) {
					if (each.state.checkpoint !== null) {
						all.push(each);
					}
				}
			}
		}
		return all;
	};

	/**
	 * Tells each agent done with the checkpoint, in every project, to carry
	 * on, and forgets the checkpoint of those it missed.
	 */
	const resumeCheckpoint = async (): Promise<Response> => {
		restarting = null;
		restarted = null;
		await carryOn();
		return Response.json({});
	};

	/**
	 * Tells each agent done with the checkpoint to carry on, which ends its
	 * checkpoint once said, and forgets the checkpoint of those it missed.
	 */
	const carryOn = async (): Promise<void> => {
		for (const conversation of await checkpointed()) {
			if (conversation.state.checkpoint === "done") {
				void conversation.prompt(RESUME).catch(() => {});
			} else {
				conversation.dismissCheckpoint();
			}
		}
	};

	/**
	 * Restarts `arbor dev` now, on a newer arbor if one is out, its agents
	 * waiting on the next run to be resumed.
	 */
	const restartFromCheckpoint = async (): Promise<Response> => {
		if (exit === null) {
			fail("usage", "arbor dev cannot restart itself here: restart it", {});
		}
		restartAfter([], false);
		return Response.json({});
	};

	const checkpointRelease = async (): Promise<Response> => {
		await checkpointAll();
		return showRelease();
	};

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
		// Its agents would carry on with nothing on the page left to show them.
		const live = await checkpointable(found.root);
		if (live.length > 0) {
			fail(
				"usage",
				`${slug} has conversations under way: stop ${live.map((each) => each.name).join(", ")} first`,
				{ project: slug, conversations: live.map((each) => each.id) },
			);
		}
		await projects.forget(found.root);
		const opened = served.get(found.root);
		served.delete(found.root);
		await (await opened?.catch(() => null))?.disposeAsync();
		return Response.json(found);
	};

	const requested = await ports.get();
	const server = Bun.serve<TerminalData>({
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
			"/api/release": guarded(showRelease),
			"/api/release/checkpoint": { POST: guarded(checkpointRelease) },
			"/api/checkpoint": { POST: talk(guarded(checkpointProjects)) },
			"/api/checkpoint/resume": { POST: talk(guarded(resumeCheckpoint)) },
			"/api/checkpoint/restart": {
				POST: talk(guarded(restartFromCheckpoint)),
			},
			"/api/projects/:slug": { DELETE: guarded(forgetProject) },
			"/api/snapshot": scoped((project) => project.snapshot),
			"/api/file": scoped((project) => project.file),
			"/api/paths": scoped((project) => project.paths),
			"/api/tasks/:task/diff": scoped((project) => project.diff),
			"/api/tasks/:task/retry": {
				POST: scoped((project) => project.retryTask),
			},
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
			"/api/todos/:id/assignee": {
				PUT: scoped((project) => project.assignTodo),
			},
			"/api/lanes/:id/assignee": {
				PUT: scoped((project) => project.assignLane),
			},
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
			"/api/conversations/sessions": {
				GET: talk(scoped((project) => project.listSessions)),
				POST: talk(scoped((project) => project.bringSession)),
			},
			"/api/conversations/checkpoint": {
				DELETE: talk(scoped((project) => project.dismissCheckpoint)),
			},
			"/api/conversations/events": talk(
				scoped((project) => project.conversationEvents),
			),
			"/api/conversations/:id/prompt": {
				POST: talk(owned((project) => project.promptConversation)),
			},
			"/api/conversations/:id/images/:name": {
				GET: talk(owned((project) => project.conversationImage)),
			},
			"/api/conversations/:id/answer": {
				POST: talk(owned((project) => project.answerConversation)),
			},
			"/api/conversations/:id/cancel": {
				POST: talk(owned((project) => project.cancelConversation)),
			},
			"/api/conversations/:id/unqueue": {
				POST: talk(owned((project) => project.unqueueConversation)),
			},
			"/api/conversations/:id/send-now": {
				POST: talk(owned((project) => project.sendQueuedNow)),
			},
			"/api/conversations/:id/setting": {
				PUT: talk(owned((project) => project.chooseSetting)),
			},
			"/api/conversations/:id/archived": {
				PUT: talk(owned((project) => project.archiveConversation)),
			},
			"/api/conversations/:id/unread": {
				PUT: talk(owned((project) => project.markUnread)),
			},
			"/api/conversations/:id/name": {
				PUT: talk(owned((project) => project.renameConversation)),
			},
			"/api/conversations/:id/task": {
				PUT: talk(owned((project) => project.moveConversation)),
			},
		},
		// Bytes both ways are the terminal's own; text is for what is not, as
		// JSON: a resize from the page, the shell's exit code from here.
		websocket: {
			open(socket) {
				const { cwd, cols, rows } = socket.data;
				const pty = new Pty({ argv: shell ?? [], cwd, cols, rows });
				socket.data.pty = pty;
				shells.add(pty);
				pty.events.on("data", (bytes) => socket.sendBinary(bytes));
				pty.events.on("exit", (code) => {
					socket.send(JSON.stringify({ type: "exit", code }));
					socket.close();
				});
			},
			message(socket, message) {
				const pty = socket.data.pty;
				if (pty === null) {
					return;
				}
				if (typeof message !== "string") {
					pty.write(message);
					return;
				}
				const parsed = TerminalMessage.safeParse(json(message));
				if (parsed.success) {
					pty.resize(parsed.data.cols, parsed.data.rows);
				}
			},
			close(socket) {
				const pty = socket.data.pty;
				if (pty !== null) {
					shells.delete(pty);
					void pty.disposeAsync();
				}
			},
		},
		// Here rather than among the routes, since only here may a request be
		// answered with an upgrade instead of a response.
		fetch: (request, server) =>
			new URL(request.url).pathname === "/api/terminal"
				? openTerminal(request, server)
				: new Response("not found", { status: 404 }),
	});
	// Read back, because `ports` may hand over 0 to mean any port at all, and
	// read now, because `server.port` is 0 once the server is stopped and this is
	// handed to a caller that stops it. Undefined only for a unix socket, which
	// this never asks for.
	const port = server.port ?? requested;
	url = `http://localhost:${port}`;
	// Open now, so the page's first request finds it ready.
	await servedAt(here);
	// And those a restart stopped agents in, which carry on once served.
	const stopped = await fs.read(reopen).catch(() => null);
	if (stopped !== null) {
		await fs.rm(reopen, { force: true });
		const { roots, resume } = parseRestart(stopped);
		restarted = resume ? "resuming" : "waiting";
		const registered = await projects.list();
		const opening = roots
			.filter((root) =>
				registered.some((each) => each.root === root && !each.gone),
			)
			.map((root) => servedAt(root).catch(() => {}));
		if (resume) {
			void Promise.all(opening).then(carryOn);
		}
	}

	log.info(`arbor dev on http://localhost:${port}`);
	const disposer = new AsyncDisposer();

	// A check that fails says nothing, and the next one tries again.
	const check = async (): Promise<void> => {
		const found = await newest();
		if (
			found === null ||
			!isNewer(found, running) ||
			found === release?.newest
		) {
			return;
		}
		release = { running, newest: found };
		log.info(
			`arbor ${found} is out (this is ${running}): restart with \`bunx @webappwiz/arbor@latest dev\``,
		);
		for (const settled of await Promise.allSettled(served.values())) {
			if (settled.status === "fulfilled") {
				settled.value.refresh();
			}
		}
	};
	void check();
	const checking = setInterval(() => void check(), checkEvery.ms);
	disposer.defer(async () => clearInterval(checking));
	// true drains open connections rather than cutting them mid-response
	disposer.defer(() => server.stop(true));
	disposer.defer(async () => {
		await Promise.all([...shells].map((pty) => pty.disposeAsync()));
	});
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

/** What `restart.json` says: the projects to open, and whether to resume. */
function parseRestart(raw: string): { roots: string[]; resume: boolean } {
	try {
		const parsed = JSON.parse(raw) as { roots?: unknown; resume?: unknown };
		return {
			roots: Array.isArray(parsed.roots) ? parsed.roots.map(String) : [],
			resume: parsed.resume === true,
		};
	} catch {
		return { roots: [], resume: false };
	}
}

/** How often an open page hears about one conversation while its agent streams. */
const BEAT = Duration.ms(50);

/**
 * How often a repo that cannot be watched is re-read to decide whether open
 * pages should refetch.
 */
const POLL_MS = 2_000;

/** How often `arbor dev` asks npm whether a newer arbor is out. */
const CHECK = Duration.mins(60);

/** How long changes to a repo's files settle before it is read again. */
const SETTLE = Duration.ms(50);

/** The one address the server binds: this machine, and nothing else. */
const LOOPBACK = "127.0.0.1";

/** Names this machine answers to, which a page opened on it always may use. */
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

/** Bigger than any screen, and small enough that a typo cannot hurt. */
const MAX_SIZE = 1000;

/** What a terminal's socket carries: where its shell runs, and the shell. */
interface TerminalData {
	cwd: string;
	cols: number;
	rows: number;
	pty: Pty | null;
}

/** The one thing a page says to its terminal that is not typing. */
const TerminalMessage = z.object({
	type: z.literal("resize"),
	cols: z.number().int().min(1).max(MAX_SIZE),
	rows: z.number().int().min(1).max(MAX_SIZE),
});

/** A phone photo fits; a stray video does not. */
const MAX_BODY_BYTES = 25 * 1024 * 1024;

/**
 * The images and recordings a todo or a task may hold, by extension, and how
 * each is served; `dev/media.tsx` shows the same ones inline.
 */
const MEDIA_TYPES: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	svg: "image/svg+xml",
	mp4: "video/mp4",
	webm: "video/webm",
	mov: "video/quicktime",
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
	 * records in `arborDir`, its commands watched through `git`; without it no page has any to show, and the routes
	 * say they are off.
	 */
	conversations?:
		| ((project: { arborDir: string; git: Git }) => Conversations)
		| null;
	/**
	 * The shell a page's terminal runs, as argv, in the main tree or a task's
	 * worktree; without it, the page has no terminal and the route says so.
	 */
	shell?: string[] | null;
	/** Opens a registered project other than the one started in, by its root. */
	open?: (root: string) => Promise<Project>;
	/**
	 * The latest arbor on npm, or null when it cannot say, asked as the server
	 * starts and hourly after; the page hints at a restart once it is past
	 * `running`. Without it, nothing is checked.
	 */
	newest?: () => Promise<string | null>;
	/** The version serving; the one installed by default. */
	running?: string;
	/** How often `newest` is asked after the first time: hourly by default. */
	checkEvery?: Duration;
	/**
	 * Ends the process with `RESTART` or `UPDATE` once the server has
	 * stopped, for its supervisor to start another; without it, the page
	 * cannot restart `arbor dev`.
	 */
	exit?: ((code: number) => void) | null;
}

/** What `dev` serves a project with: its own records, read and written. */
export type Project = Pick<
	Repository,
	"service" | "journal" | "todos" | "format" | "arborDir" | "git"
> & { fs: Fs; ps: Ps; log: Logger };

/** A route's work once its project is known. */
type Handler = (request: Request) => Promise<Response>;

/** One project as the server holds it: what each of its routes does. */
interface Served extends AsyncResource {
	root: string;
	format: Format;
	conversations: Conversations | null;
	/** Reads the repo again soon, telling its pages if anything moved. */
	refresh: () => void;
	snapshot: Handler;
	/** How many of its agents wait on the person. */
	waiting: () => Promise<number>;
	events: Handler;
	file: Handler;
	paths: Handler;
	diff: Handler;
	retryTask: Handler;
	addTodo: Handler;
	updateTodo: Handler;
	moveTodo: Handler;
	linkTodo: Handler;
	arrangeTodo: Handler;
	assignTodo: Handler;
	assignLane: Handler;
	joinLane: Handler;
	addLane: Handler;
	updateLane: Handler;
	dropLane: Handler;
	removeTodo: Handler;
	listConversations: Handler;
	startConversation: Handler;
	listSessions: Handler;
	bringSession: Handler;
	/**
	 * Asks every live conversation here to bring its ARBOR.md up to date,
	 * answering with what settles as each answers.
	 */
	checkpoint: (only?: string[]) => Promise<Promise<void>[]>;
	dismissCheckpoint: Handler;
	moveConversation: Handler;
	promptConversation: Handler;
	conversationImage: Handler;
	answerConversation: Handler;
	cancelConversation: Handler;
	unqueueConversation: Handler;
	sendQueuedNow: Handler;
	chooseSetting: Handler;
	renameConversation: Handler;
	markUnread: Handler;
	archiveConversation: Handler;
	conversationEvents: Handler;
	terminalTree: (request: Request) => Promise<string>;
}

/**
 * How many agents wait on the person, as the page's own waiting line counts
 * them, but for an external agent whose reply the page copied: only the page
 * knows that.
 */
function waitingOn(
	tasks: Details[],
	conversations: ConversationState[],
): number {
	return needs({ tasks, conversations }).filter(
		({ need }) => need.kind === "waiting",
	).length;
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

/** A terminal's size as the page asked for it, or `fallback` for nonsense. */
function dimension(asked: string | null, fallback: number): number {
	const value = Number(asked);
	return Number.isInteger(value) && value > 0 && value <= MAX_SIZE
		? value
		: fallback;
}

/** `text` as JSON, or null when it is not. */
function json(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

function refuse(status: number, reason: string, message: string): Response {
	return Response.json({ reason, message }, { status });
}
