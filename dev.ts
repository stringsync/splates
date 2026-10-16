import { AsyncDisposer, type AsyncResource } from "webappwiz/disposable";
import { Duration } from "webappwiz/time";
import { SYSTEM_STORES } from "./creds";
import { Access } from "./dev-access";
import { Dictations } from "./dev-dictation";
import { HostGate, LOOPBACK, MAX_BODY_BYTES } from "./dev-http";
import type { DevOptions } from "./dev-options";
import { DevOutcomes } from "./dev-outcomes";
import { Pages } from "./dev-pages";
import { Picker } from "./dev-picker";
import { DEFAULT_PORT, devPorts } from "./dev-ports";
import {
	type DevContext,
	type DevMachine,
	type Handler,
	type Project,
	type Served,
	serveProject,
} from "./dev-project";
import { Pushes } from "./dev-push";
import { Restarts } from "./dev-restart";
import { SetupRoutes } from "./dev-setup";
import { CONNECTIONS, type Connection } from "./dev-sockets";
import { Terminals } from "./dev-terminal";
import { transcriberFor } from "./dev-transcriber";
import { startTunnel } from "./dev-tunnel";
import { Versions } from "./dev-versions";
import { DevWorkers } from "./dev-workers";
import { Everywhere } from "./everywhere";
import { fail } from "./exit";
import { HeavyJobs } from "./heavy";
import { Machine, osSensors } from "./machine";
import { RUNNING } from "./release";
import { openRepository } from "./repository";
import { arborHome } from "./roster";
import { Setup } from "./setup";
import { SETUP_AREAS } from "./setup-areas";
import { LocalWorkerMachine } from "./worker-machine";

export type { DevOptions } from "./dev-options";
export { DEFAULT_PORT, devPorts, PORT_SPAN } from "./dev-ports";

/**
 * Serves what `todo list`, `list` and `show` print as one page that refetches
 * when the repo changes, where a person adds, edits, reorders and removes
 * todos. Anything that moves a task (merge, claim) stays in the CLI, and
 * removing one answers only to this machine's own names, so a page that
 * should not have been reachable can at worst change a todo.
 *
 * Given `conversations`, the page also talks to agents, which run commands on
 * this machine. Those routes answer only to this machine's own names, or,
 * given `access`, to a host `hosts` lets in once Cloudflare Access verified
 * who is asking; without it, a tunnel still reaches no further than the todos.
 */
export async function dev(
	deps: DevMachine,
	{
		ports = devPorts(DEFAULT_PORT),
		hosts = [],
		access = null,
		tunnel = null,
		conversations: converse = null,
		shell = null,
		transcriber = transcriberFor,
		newest = async () => null,
		running = RUNNING,
		checkEvery = CHECK,
		source = async () => null,
		sourceEvery = SOURCE_CHECK,
		unbuilt = false,
		rebuilds = null,
		slot = null,
		servers = async () => [],
		exit = null,
		sensors = null,
		heavy = null,
		workerSocket = null,
		workers: givenWorkers = null,
		worker = null,
		pusher,
		open = async (root) => ({
			fs: deps.fs,
			ps: deps.ps,
			log: deps.log,
			...(await openRepository(deps, { at: root, migrates: true })),
		}),
	}: DevOptions = {},
): Promise<DevServer> {
	const { fs, ps, log, assets, projects, opened = [] } = deps;
	// The page is the one thing a tunnel exposes, so no tunnel runs unguarded.
	if (tunnel !== null && access === null) {
		fail(
			"usage",
			"a tunnel needs Cloudflare Access in front: give --access-team and --access-aud",
			{ host: tunnel.host },
		);
	}
	const gate = new HostGate(
		tunnel === null ? hosts : [...hosts, tunnel.host],
		log,
		access === null ? null : new Access(access),
	);
	const { guarded, local } = gate;
	const talk = local;
	/** Where the agents' own `arbor` reaches this server, once it listens. */
	let url: string | null = null;
	// The page itself is a React app under `dev/`, built before publishing and
	// carried in the bundle, so nothing here builds markup and nothing reads it
	// off disk.
	const asset =
		(body: () => string | Uint8Array<ArrayBuffer>, type: string) =>
		(request: Request): Response =>
			pages.respond(request, body(), type);

	// Read on each request, since a rebuild replaces what is served.
	const pages = new Pages(assets);

	// By root, each opened on its first request: the focused one at once,
	// every other registered one only when a page asks for it.
	const served = new Map<string, Promise<Served>>();
	const context: DevContext = {
		get url() {
			return url;
		},
		get release() {
			return versions.release;
		},
		get behind() {
			return versions.behind;
		},
		unbuilt,
		slot,
		pages,
		conversationsFor: ({ arborDir, git }) =>
			converse?.({ arborDir, git }) ?? null,
		transcriberFor: transcriber,
		everywhere: Everywhere.served(served, projects),
	};
	const serve = (project: Project): Promise<Served> =>
		serveProject(project, context);

	const servedAt = (root: string): Promise<Served> => {
		let found = served.get(root);
		if (found === undefined) {
			const ready = opened.find((each) => each.git.root === root);
			found = (ready === undefined ? open(root) : Promise.resolve(ready)).then(
				serve,
			);
			// One that failed to open is tried again on the next request.
			found.catch(() => served.delete(root));
			served.set(root, found);
		}
		return found;
	};

	/** The project a request names with `?project=`, or the focused one. */
	const projectFor = (request: Request): Promise<Served> =>
		projectNamed(new URL(request.url).searchParams.get("project") ?? "");

	/** The project `slug` names, or the focused one for none. */
	const projectNamed = async (slug: string): Promise<Served> => {
		if (slug === "") {
			const focused = await projects.focused();
			if (focused === null) {
				fail("not_found", "no arbor project yet: add one by its path", {
					project: slug,
				});
			}
			return servedAt(focused.root);
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

	const workers = givenWorkers ?? new DevWorkers(log);
	const terminals = new Terminals(gate, shell, { projectFor }, workers.local);
	const dictations = new Dictations(gate, { projectFor });

	const disposer = new AsyncDisposer();
	const versions = await Versions.start(served, log, {
		running,
		newest,
		checkEvery,
		source,
		sourceEvery,
	});
	const restarts = new Restarts(
		{
			fs,
			ps,
			log,
			projects,
			served: { served, servedAt, projectNamed },
			terminals,
			machine: worker ?? new LocalWorkerMachine(ps, fs),
			server: disposer,
		},
		versions,
		{ exit, open, servers },
	);
	const {
		listProjects,
		checkpointProjects,
		restartIdle,
		powerNow,
		forgetProject,
	} = restarts;

	const picker = new Picker(deps);

	const ended = new DevOutcomes(deps);

	// Every project's, to each device that subscribed, whichever page it was on.
	const pushes = await Pushes.start({
		fs,
		ps,
		log,
		projects,
		served,
		pusher,
	});
	disposer.defer(async () => pushes.dispose());
	if (rebuilds !== null) {
		const rebuilding = rebuilds(pages);
		disposer.defer(async () => rebuilding.dispose());
	}

	// Not any project's: every page on this server shares one machine.
	const machine = new Machine(sensors ?? osSensors(fs));
	const jobs = heavy ?? HeavyJobs.ofMachine({ fs, ps, log });
	const setup = new SetupRoutes(
		new Setup(
			{
				fs,
				home: arborHome(ps),
				device: (deps.secrets ?? SYSTEM_STORES).device,
				fetch: deps.fetch,
			},
			SETUP_AREAS,
		),
	);

	disposer.defer(() => workers.disposeAsync());
	if (workerSocket !== null) {
		await workers.listen(workerSocket, fs);
	}

	const requested = await ports.get();
	const server = Bun.serve<Connection>({
		port: requested,
		// This machine only. Reaching it from anywhere else is a tunnel's job,
		// which connects from here too.
		hostname: LOOPBACK,
		maxRequestBodySize: MAX_BODY_BYTES,
		// Zero never closes an idle connection, which is what the SSE stream needs:
		// it is idle by design between the things it has to say.
		idleTimeout: 0,
		// The static files are handed over without entering JS; the rest have
		// to be asked for, since they answer with the state of the repo right now.
		routes: {
			"/": asset(() => pages.page, "text/html; charset=utf-8"),
			"/main.js": asset(
				() => pages.assets.script,
				"text/javascript; charset=utf-8",
			),
			"/main.js.map": asset(() => pages.assets.scriptMap, "application/json"),
			"/styles.css": asset(
				() => pages.assets.styles,
				"text/css; charset=utf-8",
			),
			// At the root, so its scope is the whole page.
			"/worker.js": asset(
				() => pages.assets.worker,
				"text/javascript; charset=utf-8",
			),
			"/worker.js.map": asset(() => pages.assets.workerMap, "application/json"),
			"/manifest.webmanifest": asset(
				() => pages.assets.manifest,
				"application/manifest+json; charset=utf-8",
			),
			"/icon-192.png": asset(() => pages.assets.icons[192], "image/png"),
			"/icon-512.png": asset(() => pages.assets.icons[512], "image/png"),
			"/api/projects": {
				GET: guarded(listProjects),
				// It runs `bunx skills add` there, so only as far as a
				// conversation reaches.
				POST: talk(guarded(picker.add)),
			},
			"/api/projects/:slug/commit": { POST: talk(guarded(picker.commit)) },
			// An agent of another project handed it a task: its agent starts
			// only once the project is served.
			"/api/projects/:slug/serve": {
				POST: talk(
					guarded(async (request) => {
						await projectNamed(
							new URL(request.url).pathname.split("/")[3] ?? "",
						);
						return new Response(null, { status: 204 });
					}),
				),
			},
			"/api/focus": { PUT: guarded(picker.focus) },
			"/api/stats": guarded(ended.stats),
			"/api/identity": guarded(async (request) =>
				Response.json({
					email: (await gate.identity(request))?.email ?? null,
				}),
			),
			"/api/machine": guarded(async () =>
				Response.json({ ...(await machine.read()), heavy: await jobs.read() }),
			),
			// Through a tunnel only once Access verified who is asking, as a
			// conversation is: what an agent said goes to the device.
			"/api/push": talk(guarded(pushes.key)),
			"/api/push/subscription": {
				PUT: talk(guarded(pushes.subscribe)),
				DELETE: talk(guarded(pushes.unsubscribe)),
			},
			"/api/setup": guarded(setup.read),
			"/api/setup/seen": { PUT: guarded(setup.see) },
			"/api/setup/:step/skipped": { PUT: guarded(setup.skip) },
			"/api/restart": { POST: talk(guarded(restartIdle)) },
			"/api/power": { POST: talk(guarded(powerNow)) },
			"/api/checkpoint": { POST: talk(guarded(checkpointProjects)) },
			"/api/projects/:slug": { DELETE: guarded(forgetProject) },
			"/api/snapshot": scoped((project) => project.snapshot),
			"/api/file": scoped((project) => project.file),
			"/api/paths": scoped((project) => project.paths),
			"/api/systems": scoped((project) => project.systems),
			"/api/systems/changes": scoped((project) => project.systemChanges),
			"/api/tasks/:task/diff": scoped((project) => project.diff),
			"/api/tasks/:task/outcome": scoped((project) =>
				ended.landed(project.root),
			),
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
			"/api/lanes/:id/join": { POST: scoped((project) => project.joinLane) },
			"/api/lanes": { POST: scoped((project) => project.addLane) },
			// Through a tunnel only once Access verified who is asking, as a
			// conversation is: a cred is worth as much as what it opens.
			"/api/creds": talk(scoped((project) => project.listCreds)),
			"/api/creds/:name": {
				PUT: talk(scoped((project) => project.saveCred)),
				DELETE: talk(scoped((project) => project.removeCred)),
			},
			"/api/creds/:name/dismiss": {
				POST: talk(scoped((project) => project.dismissCred)),
			},
			"/api/budgets": scoped((project) => project.listBudgets),
			"/api/budgets/:role": { PUT: scoped((project) => project.setBudget) },
			"/api/budgets/:role/raises": {
				POST: scoped((project) => project.raiseBudget),
			},
			"/api/budgets/:role/pause": {
				PUT: scoped((project) => project.pauseBudget),
				DELETE: scoped((project) => project.resumeBudget),
			},
			"/api/budgets/raises/:id": {
				DELETE: scoped((project) => project.endRaise),
			},
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
			"/api/conversations/limits": {
				POST: talk(scoped((project) => project.refreshLimits)),
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
			"/api/conversations/:id/tell": {
				POST: talk(owned((project) => project.tellConversation)),
			},
			"/api/conversations/:id/terminate": {
				POST: talk(owned((project) => project.terminateConversation)),
			},
			"/api/conversations/:id/answer": {
				POST: talk(owned((project) => project.answerConversation)),
			},
			"/api/conversations/:id/cancel": {
				POST: talk(owned((project) => project.cancelConversation)),
			},
			"/api/conversations/:id/pause": {
				POST: talk(owned((project) => project.pauseConversation)),
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
			"/api/conversations/:id/pinned": {
				PUT: talk(owned((project) => project.pinConversation)),
			},
			"/api/conversations/:id/name": {
				PUT: talk(owned((project) => project.renameConversation)),
			},
			"/api/conversations/:id/task": {
				PUT: talk(owned((project) => project.moveConversation)),
			},
		},
		websocket: CONNECTIONS,
		// Here rather than among the routes, since only here may a request be
		// answered with an upgrade instead of a response.
		fetch: (request, server) => {
			const { pathname } = new URL(request.url);
			if (pathname === "/api/terminal") {
				return terminals.open(request, server);
			}
			if (pathname === "/api/dictation") {
				return dictations.open(request, server);
			}
			if (pathname === "/api/workers") {
				return workers.route(request, server, guarded);
			}
			return new Response("not found", { status: 404 });
		},
	});
	// Read back, because `ports` may hand over 0 to mean any port at all, and
	// read now, because `server.port` is 0 once the server is stopped and this is
	// handed to a caller that stops it. Undefined only for a unix socket, which
	// this never asks for.
	const port = server.port ?? requested;
	url = `http://localhost:${port}`;
	// Open now, so the page's first request finds it ready; one that fails
	// says so when the page asks for it.
	const focused = await projects.focused();
	if (focused !== null) {
		await servedAt(focused.root).catch((error: unknown) =>
			log.error(`${focused.root} did not open: ${String(error)}`),
		);
	}
	// And those a restart stopped agents in, which carry on once served.
	await restarts.reopenStopped();

	log.info(`arbor dev on http://localhost:${port}`);
	if (tunnel !== null) {
		const carrying = await startTunnel(tunnel, url, log);
		if (carrying !== null) {
			disposer.defer(() => carrying.disposeAsync());
		}
	}
	const checks = versions.check();
	disposer.defer(async () => checks.dispose());
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

/** How often `arbor dev` asks npm whether a newer arbor is out. */
const CHECK = Duration.mins(60);

/** How often `arbor dev` run from a checkout reads its source's last commit. */
const SOURCE_CHECK = Duration.secs(15);

/** A running server, and the one thing a caller ever wants to do with it. */
export interface DevServer extends AsyncResource {
	port: number;
}
