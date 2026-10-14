import { AsyncDisposer, type AsyncResource } from "webappwiz/disposable";
import {
	MAX_PORT,
	OpenPortProvider,
	type PortProvider,
} from "webappwiz/system";
import { Duration } from "webappwiz/time";
import type { Conversations } from "./conversations";
import type { Assets } from "./dev/assets";
import { Access, type AccessConfig } from "./dev-access";
import { HostGate, LOOPBACK, MAX_BODY_BYTES } from "./dev-http";
import {
	type DevContext,
	type Handler,
	type Project,
	type Served,
	serveProject,
} from "./dev-project";
import { Restarts } from "./dev-restart";
import { type TerminalData, Terminals } from "./dev-terminal";
import { startTunnel, type TunnelConfig } from "./dev-tunnel";
import { Versions } from "./dev-versions";
import { fail } from "./exit";
import type { Git } from "./git";
import { Machine, type MachineSensors, osSensors } from "./machine";
import { Outcomes } from "./outcomes";
import type { Projects } from "./projects";
import { RUNNING } from "./release";
import { openRepository } from "./repository";
import { arborHome } from "./roster";
import type { Slot } from "./slots";
import { isPeriodId, PERIODS, summarize } from "./stats";

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
 * this machine. Those routes answer only to this machine's own names, or,
 * given `access`, to a host `hosts` lets in once Cloudflare Access verified
 * who is asking; without it, a tunnel still reaches no further than the todos.
 */
export async function dev(
	home: Project & { assets: Assets; projects: Projects },
	{
		ports = devPorts(DEFAULT_PORT),
		hosts = [],
		access = null,
		tunnel = null,
		conversations: converse = null,
		shell = null,
		newest = async () => null,
		running = RUNNING,
		checkEvery = CHECK,
		source = async () => null,
		sourceEvery = SOURCE_CHECK,
		unbuilt = false,
		slot = null,
		exit = null,
		sensors = null,
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
	const asset = (
		body: string | Uint8Array<ArrayBuffer>,
		type: string,
	): Response => new Response(body, { headers: { "content-type": type } });

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
		conversationsFor: ({ arborDir, git }) =>
			converse?.({ arborDir, git }) ?? null,
		dismiss: () => restarts.dismiss(),
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
			here,
			served: { served, servedAt, projectNamed },
			terminals,
			server: disposer,
		},
		versions,
		{ exit, open },
	);
	const {
		listProjects,
		checkpointProjects,
		resumeCheckpoint,
		restartFromCheckpoint,
		restartIdle,
		forgetProject,
	} = restarts;

	// Every project's, from the record the CLI writes as each task ends, so
	// one that is not open here still counts.
	const outcomes = new Outcomes(`${arborHome(ps)}/outcomes.jsonl`, fs);
	// `?period=` names the period, as `PERIODS` does, or `all` for all time;
	// 7 days for none.
	const listStats = async (request: Request): Promise<Response> => {
		const period = new URL(request.url).searchParams.get("period") ?? "7d";
		if (!isPeriodId(period)) {
			fail(
				"usage",
				`period is one of ${[...Object.keys(PERIODS), "all"].join(", ")}: not ${period}`,
				{ period },
			);
		}
		return Response.json(summarize(await outcomes.list(), { period }));
	};

	// Not any project's: every page on this server shares one machine.
	const machine = new Machine(sensors ?? osSensors(fs));

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
		// The static files are handed over without entering JS; the rest have
		// to be asked for, since they answer with the state of the repo right now.
		routes: {
			"/": asset(assets.shell, "text/html; charset=utf-8"),
			"/main.js": asset(assets.script, "text/javascript; charset=utf-8"),
			"/styles.css": asset(assets.styles, "text/css; charset=utf-8"),
			"/manifest.webmanifest": asset(
				assets.manifest,
				"application/manifest+json; charset=utf-8",
			),
			"/icon-192.png": asset(assets.icons[192], "image/png"),
			"/icon-512.png": asset(assets.icons[512], "image/png"),
			"/api/projects": guarded(listProjects),
			"/api/stats": guarded(listStats),
			"/api/identity": guarded(async (request) =>
				Response.json({
					email: (await gate.identity(request))?.email ?? null,
				}),
			),
			"/api/machine": guarded(async () => Response.json(await machine.read())),
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

/** What `dev` lets a caller choose. */
export interface DevOptions {
	/** Where to listen; the port `--port` asked for, and the span above it. */
	ports?: PortProvider;
	/**
	 * Host names besides this machine's own that the page may be reached by,
	 * like the hostname of a tunnel. Anything else is refused, which is what
	 * stops another site from reading the repo through a browser pointed at
	 * localhost. Who may use those names is the Access policy's business, not
	 * arbor's.
	 */
	hosts?: string[];
	/**
	 * The Cloudflare Access application in front of `hosts`, or null for none.
	 * Given one, a request to those hosts must carry a token it signed, and
	 * then may use conversations and terminals too. Anything that exposes the
	 * page beyond this machine refuses to without it.
	 */
	access?: AccessConfig | null;
	/**
	 * The Cloudflare tunnel to run once listening, whose host `hosts` also
	 * lets in. Refused without `access`.
	 */
	tunnel?: TunnelConfig | null;
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
	/** The slot `arbor dev --slot` serves under, which the page shows; null for none. */
	slot?: Slot | null;
	/**
	 * Ends the process with `RESTART` or `UPDATE` once the server has
	 * stopped, for its supervisor to start another; without it, the page
	 * cannot restart `arbor dev`.
	 */
	exit?: ((code: number) => void) | null;
	/** Where the page's machine stats come from; this machine's OS for none. */
	sensors?: MachineSensors | null;
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
