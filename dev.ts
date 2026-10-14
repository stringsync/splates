// scry-ignore-file compact-files: the restart and version state still here leaves with todo #118, which removes this line
import { AsyncDisposer, type AsyncResource } from "webappwiz/disposable";
import {
	MAX_PORT,
	OpenPortProvider,
	type PortProvider,
} from "webappwiz/system";
import { Duration } from "webappwiz/time";
import type { After, Conversation, Conversations } from "./conversations";
import type { Assets } from "./dev/assets";
import { HostGate, LOOPBACK, MAX_BODY_BYTES } from "./dev-http";
import {
	type DevContext,
	type Handler,
	type Project,
	type Served,
	serveProject,
	waitingOn,
} from "./dev-project";
import { type TerminalData, Terminals } from "./dev-terminal";
import { fail } from "./exit";
import type { Git } from "./git";
import { type Held, heldBy } from "./held";
import { Outcomes } from "./outcomes";
import type { Projects } from "./projects";
import { RESUME } from "./prompts";
import { type Behind, isNewer, type Release, RUNNING } from "./release";
import { openRepository } from "./repository";
import { arborHome } from "./roster";
import { tasksOf } from "./snapshot";
import { summarize } from "./stats";
import { RESTART, UPDATE } from "./supervise";

/** Preferred, not required: `dev` moves up from here when it is taken. */
export const DEFAULT_PORT = 4269;

/** How far above the port asked for `dev` will look before giving up. */
export const PORT_SPAN = 20;

/**
 * Serves what `todo list`, `list` and `show` print as one page that refetches
 * when the repo changes, where a person adds, edits, reorders and removes
 * todos. Anything that moves a task (merge, claim) stays in the CLI, and
 * removing one answers only to this machine's own names, so a page that
 * should not have been reachable can at worst change a todo.
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
		source = async () => null,
		sourceEvery = SOURCE_CHECK,
		unbuilt = false,
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
	const gate = new HostGate(hosts, log);
	const { guarded, local } = gate;
	const talk = local;
	/** Where the agents' own `arbor` reaches this server, once it listens. */
	let url: string | null = null;
	/** A newer arbor on npm, once a check has found one; every page says so. */
	let release: Release | null = null;
	/**
	 * The last commit to arbor's own source as this run started, or null when
	 * it does not run from a checkout of it.
	 */
	const started = await source();
	/** Commits to that source since, once a check has seen one. */
	let behind: Behind | null = null;
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

	// The page itself is a React app under `dev/`, built before publishing and
	// carried in the bundle, so nothing here builds markup and nothing reads it
	// off disk.
	const asset = (body: string, type: string): Response =>
		new Response(body, { headers: { "content-type": type } });

	const context: DevContext = {
		get url() {
			return url;
		},
		get release() {
			return release;
		},
		get behind() {
			return behind;
		},
		unbuilt,
		conversationsFor: ({ arborDir, git }) =>
			converse?.({ arborDir, git }) ?? null,
		dismiss: () => {
			restarting = null;
			restarted = null;
		},
	};
	const serve = (project: Project): Promise<Served> =>
		serveProject(project, context);

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

	const terminals = new Terminals(gate, shell, { projectFor });

	// Each with the conversations a checkpoint would ask, or has asked, in
	// it: only those of a project this server has opened, since one not yet
	// opened has none running. And with how many agents wait on the person
	// there. Says whether a restart is to follow the checkpoint, and which run
	// this is, for the page to see it come back.
	const listProjects = async (): Promise<Response> => {
		if (restarted === "resuming" && (await checkpointed()).length === 0) {
			restarted = null;
		}
		// Read before the conversations, so a checkpoint asked meanwhile never
		// pairs its restart with agents not yet asked, which reads as restarting.
		const then = { restarting, restarted };
		return Response.json({
			projects: await Promise.all(
				(await projects.list()).map(async (each) => ({
					...each,
					here: each.root === here,
					conversations: await checkpointable(each.root),
					waiting: each.gone ? 0 : await waitingIn(each.root),
				})),
			),
			...then,
			run,
			running,
			newest: release?.newest ?? null,
			behind,
			restartable: exit !== null,
			held: await holding(),
		});
	};

	// Every project's, from the record the CLI writes as each task ends, so
	// one that is not open here still counts.
	const outcomes = new Outcomes(`${arborHome(ps)}/outcomes.jsonl`, fs);
	// `?weeks=` names the period, `all` for all time; 12 weeks for none.
	const listStats = async (request: Request): Promise<Response> => {
		const asked = new URL(request.url).searchParams.get("weeks") ?? "12";
		const weeks = asked === "all" ? null : Number(asked);
		if (weeks !== null && !(Number.isInteger(weeks) && weeks > 0)) {
			fail("usage", `weeks is a whole number of weeks, or all: not ${asked}`, {
				weeks: asked,
			});
		}
		return Response.json(summarize(await outcomes.list(), { weeks }));
	};

	/**
	 * What a restart would kill: the job in front in each of the page's
	 * shells, and each command an idle agent left running. An agent at work
	 * holds a restart off on its own.
	 */
	const holding = async (): Promise<Held[]> => {
		const agents: { name: string; pid: number }[] = [];
		for (const settled of await Promise.allSettled(served.values())) {
			const project = settled.status === "fulfilled" ? settled.value : null;
			for (const each of (await project?.conversations?.list()) ?? []) {
				const { state, pid } = each;
				if (
					pid !== null &&
					state.status !== "running" &&
					state.status !== "starting"
				) {
					agents.push({
						name: state.name ?? state.lastTask ?? state.title ?? state.agent,
						pid,
					});
				}
			}
		}
		const shells = terminals.pids;
		if (shells.length === 0 && agents.length === 0) {
			return [];
		}
		return heldBy(await ps.processes(), {
			shells,
			agents,
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

	/**
	 * Restarts `arbor dev` once each checkpoint `asked` has been answered,
	 * unless dismissed meanwhile. Without `reopen`, the next run starts as if
	 * started afresh, as for a restart with every agent idle.
	 */
	const restartAfter = (
		asked: Promise<void>[],
		resume: boolean,
		{ reopens = true }: { reopens?: boolean } = {},
	): void => {
		restarting = { resume };
		void Promise.all(asked).then(async () => {
			if (restarting === null) {
				return;
			}
			if (reopens) {
				const roots: string[] = [];
				for (const [root, opened] of served) {
					const project = await opened.catch(() => null);
					const all = (await project?.conversations?.list()) ?? [];
					if (root !== here && all.some((each) => each.stoppedByCheckpoint)) {
						roots.push(root);
					}
				}
				await fs.write(reopen, `${JSON.stringify({ roots, resume })}\n`);
			}
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

	/**
	 * Restarts `arbor dev` now, refused while any agent is at work, or a
	 * command it would kill runs: a job in front in a shell, or one an idle
	 * agent left running.
	 */
	const restartIdle = async (): Promise<Response> => {
		if (exit === null) {
			fail("usage", "arbor dev cannot restart itself here: restart it", {});
		}
		const working: { id: string; name: string }[] = [];
		for (const settled of await Promise.allSettled(served.values())) {
			const project = settled.status === "fulfilled" ? settled.value : null;
			for (const { state } of (await project?.conversations?.list()) ?? []) {
				if (state.status === "running" || state.status === "starting") {
					working.push({
						id: state.id,
						name: state.name ?? state.lastTask ?? state.title ?? state.agent,
					});
				}
			}
		}
		if (working.length > 0) {
			fail(
				"usage",
				`agents are at work: ${working.map((each) => each.name).join(", ")}`,
				{ conversations: working.map((each) => each.id) },
			);
		}
		const held = await holding();
		if (held.length > 0) {
			fail(
				"usage",
				`commands are running: ${held.map((each) => `${each.command} (${each.where})`).join(", ")}`,
				{ held },
			);
		}
		restartAfter([], false, { reopens: false });
		return Response.json({});
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
			"/api/stats": guarded(listStats),
			"/api/restart": { POST: talk(guarded(restartIdle)) },
			"/api/checkpoint": { POST: talk(guarded(checkpointProjects)) },
			"/api/checkpoint/resume": { POST: talk(guarded(resumeCheckpoint)) },
			"/api/checkpoint/restart": {
				POST: talk(guarded(restartFromCheckpoint)),
			},
			"/api/projects/:slug": { DELETE: guarded(forgetProject) },
			"/api/snapshot": scoped((project) => project.snapshot),
			"/api/file": scoped((project) => project.file),
			"/api/paths": scoped((project) => project.paths),
			"/api/systems": scoped((project) => project.systems),
			"/api/tasks/:task/diff": scoped((project) => project.diff),
			"/api/tasks/:task/retry": {
				POST: scoped((project) => project.retryTask),
			},
			"/api/tasks/:task": {
				DELETE: talk(scoped((project) => project.removeTask)),
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
			"/api/conversations/:id/attachments/:name": {
				GET: talk(owned((project) => project.conversationAttachment)),
			},
			"/api/conversations/:id/answer": {
				POST: talk(owned((project) => project.answerConversation)),
			},
			"/api/conversations/:id/cancel": {
				POST: talk(owned((project) => project.cancelConversation)),
			},
			"/api/conversations/:id/background/:background": {
				GET: talk(owned((project) => project.backgroundOutput)),
			},
			"/api/conversations/:id/stop-background": {
				POST: talk(owned((project) => project.stopBackground)),
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
		websocket: terminals.websocket,
		// Here rather than among the routes, since only here may a request be
		// answered with an upgrade instead of a response.
		fetch: (request, server) =>
			new URL(request.url).pathname === "/api/terminal"
				? terminals.open(request, server)
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
	// From a checkout, a restart runs its source again rather than npm's arbor,
	// so commits to it are what make this run stale.
	const checkSource = async (): Promise<void> => {
		const found = await source();
		if (
			started === null ||
			found === null ||
			found === started ||
			found === behind?.newest
		) {
			return;
		}
		behind = { running: started, newest: found };
		log.info(
			`arbor's source is at ${found.slice(0, 8)} (this runs ${started.slice(0, 8)}): restart to pick it up`,
		);
		for (const settled of await Promise.allSettled(served.values())) {
			if (settled.status === "fulfilled") {
				settled.value.refresh();
			}
		}
	};
	const checks =
		started === null
			? setInterval(() => void check(), checkEvery.ms)
			: setInterval(() => void checkSource(), sourceEvery.ms);
	if (started === null) {
		void check();
	}
	disposer.defer(async () => clearInterval(checks));
	// true drains open connections rather than cutting them mid-response
	disposer.defer(() => server.stop(true));
	disposer.defer(() => terminals.disposeAsync());
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

/** How often `arbor dev` asks npm whether a newer arbor is out. */
const CHECK = Duration.mins(60);

/** How often `arbor dev` run from a checkout reads its source's last commit. */
const SOURCE_CHECK = Duration.secs(15);

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
	 * The last commit to arbor's own source, or null when it does not run
	 * from a checkout. Asked as the server starts, then every `sourceEvery`;
	 * once it moves on, the page hints at a restart. A server started from a
	 * checkout asks this in place of `newest`, since a restart runs the
	 * checkout again. Without it, nothing is checked.
	 */
	source?: () => Promise<string | null>;
	/** How often `source` is asked after the first time. */
	sourceEvery?: Duration;
	/**
	 * Whether building the page failed before this start, so what it serves
	 * is the page built before; the page says so.
	 */
	unbuilt?: boolean;
	/**
	 * Ends the process with `RESTART` or `UPDATE` once the server has
	 * stopped, for its supervisor to start another; without it, the page
	 * cannot restart `arbor dev`.
	 */
	exit?: ((code: number) => void) | null;
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
