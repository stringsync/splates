import { homedir } from "node:os";
// scry-ignore-file compact-files: the dev server and its route table, each body handed to its own module

import { AsyncDisposer, type AsyncResource } from "webappwiz/disposable";
import { Duration } from "webappwiz/time";
import { AutoPickRulesRoutes } from "../auto-pick";
import { ConfigFiles } from "../config";
import { SERVER_TOLD } from "../conversations";
import { SYSTEM_STORES } from "../creds";
import { Dictations, transcriberFor } from "../dictate";
import {
	EvalAgentsRoutes,
	EvalLaunches,
	EvalLaunchRoutes,
	EvalRoutes,
	projectEvalCommands,
} from "../evals";
import { fail } from "../exit";
import { Roster, splatesHome } from "../models";
import { claimedFirst, DevTaskPorts, portOwnersOf, SLOT_POOL } from "../ports";
import { Everywhere, EverywhereRoutes, Picker } from "../projects";
import { Pushes } from "../push";
import { OpenBoards, openRepository } from "../records";
import {
	OpenCodeSetup,
	OpenCodeSetupRoutes,
	SETUP_AREAS,
	Setup,
	SetupRoutes,
	setupProjectAt,
} from "../setup";
import { CascadeRoutes, Cascades, planShip, registeredGraph } from "../ship";
import { BillingRoutes, readPlans, Spend } from "../spend";
import { DevOutcomes } from "../stats";
import { FsStorage } from "../storage";
import { Terminals } from "../terminal";
import { Access, SavedTunnel, startTunnel, tunnelRemove } from "../tunnel";
import {
	DevWorkers,
	LocalWorkerMachine,
	Machine,
	OsSensors,
	queueListing,
	type WorkerPool,
} from "../workers";
import { HostGate, LOOPBACK, MAX_BODY_BYTES } from "./http";
import { Migrations } from "./migrations";
import type { DevOptions } from "./options";
import { Pages } from "./pages";
import { DEFAULT_PORT, devPorts } from "./ports";
import {
	type DevContext,
	type DevMachine,
	type Handler,
	type Project,
	type Served,
	serveProject,
} from "./project";
import { RUNNING } from "./release";
import { Replicas } from "./replicas";
import { Restarts } from "./restart";
import { Serving } from "./serving";
import { CONNECTIONS, type Connection } from "./sockets";
import { SERVING } from "./supervise";
import { Versions } from "./versions";

export type { DevOptions } from "./options";
export { DEFAULT_PORT, devPorts, PORT_SPAN } from "./ports";

/** How many times `dev` binds before it gives up on a port that keeps being taken. */
const BIND_ATTEMPTS = 5;

/**
 * Serves the splates page, which shows what `task list`, `list` and `show`
 * print and stays current as the repo changes, for a person to add, edit,
 * reorder and remove queued tasks. Given `conversations`, it also talks to
 * agents. Pass `hosts` and `access` to let in hosts other than this machine
 * once Cloudflare Access verified who is asking.
 */
// Anything that moves a started task (merge, claim) stays in the CLI, and
// removing one answers only to this machine's own names, so a page that
// should not have been reachable can at worst change a queued task. The
// conversation routes, which run commands on this machine, answer only to
// its own names or, given `access`, to a verified host; without it, a tunnel
// reaches no further than the queued tasks.
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
		checkEvery = Duration.mins(60), // how often to ask npm for a newer splates
		source = async () => null,
		sourceEvery = Duration.secs(15), // so a commit in a checkout shows within seconds
		unbuilt = false,
		slot = null,
		servers = async () => [],
		exit = null,
		deadlineMs,
		sensors = null,
		workerSocket = null,
		workers: givenWorkers = null,
		worker = null,
		coordinator = null,
		portsHost = null,
		pusher,
		open: givenOpen,
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
	// A task's server is reached as the page is, so never without Access.
	if (portsHost !== null && access === null) {
		fail(
			"usage",
			"task ports need Cloudflare Access in front: give --access-team and --access-aud",
			{ host: portsHost },
		);
	}
	const gate = new HostGate(
		tunnel === null ? hosts : [...hosts, tunnel.host],
		log,
		access === null ? null : new Access(access),
	);
	const { guarded, local } = gate;
	const talk = local;
	/** Where the agents' own `splates` reaches this server, once it listens. */
	let url: string | null = null;
	const pages = new Pages(assets);

	// By root, each opened on its first request: the focused one at once,
	// every other registered one only when a page asks for it.
	const served = new Map<string, Promise<Served>>();
	const replicas = new Replicas(log);
	const context: DevContext = {
		replicas,
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
		conversationsFor: ({ dir, storage, git, service, creds, journal }) =>
			converse?.({
				dir,
				storage,
				git,
				config: service.config,
				creds,
				service,
				journal,
			}) ?? null,
		transcriberFor: transcriber,
		everywhere: Everywhere.served(served, projects),
		boards: new OpenBoards({ fs, ps, log }, projects),
		onWorkerRoom: (listener) =>
			workers.placement.scheduler.events.on("changed", listener),
		paused: () => workers.records.paused,
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
			found.then(
				(project) => everywhere.added(root, project),
				() => served.delete(root),
			);
			served.set(root, found);
		}
		return found;
	};

	/** Opens the project at `root` apart from serving it, only to replicate it. */
	const startReplicating = (root: string): void => {
		// A served one replicates from `serveProject`.
		if (served.has(root)) {
			return;
		}
		const ready = opened.find((each) => each.git.root === root);
		(ready === undefined ? open(root) : Promise.resolve(ready))
			.then((project) => replicas.of(project))
			.catch((error: unknown) =>
				log.error(`${root} did not open to replicate: ${String(error)}`),
			);
	};

	/** The project a request names with `?project=`, or the focused one. */
	const projectFor = (request: Request): Promise<Served> =>
		projectNamed(new URL(request.url).searchParams.get("project") ?? "");

	/** The project `slug` names, or the focused one for none. */
	const projectNamed = async (slug: string): Promise<Served> => {
		if (slug === "") {
			const focused = await projects.focused();
			if (focused === null) {
				fail("not_found", "no splates project yet: add one by its path", {
					project: slug,
				});
			}
			return servedAt(focused.root);
		}
		const found = (await projects.list()).find((each) => each.slug === slug);
		if (found === undefined) {
			fail("not_found", `no splates project '${slug}'`, { project: slug });
		}
		if (found.gone) {
			fail("not_found", `${found.root} is gone: moved or deleted`, {
				project: slug,
			});
		}
		return servedAt(found.root);
	};

	// Again on every request, since a newer splates may have migrated the
	// records since this server started.
	const scoped =
		(pick: (project: Served) => Handler) =>
		(request: Request): Promise<Response> =>
			guarded(async (request) => {
				const project = await projectFor(request);
				await project.format.check();
				return pick(project)(request);
			})(request);

	// Every registered project's tasks and conversations, to one page.
	const everywhere = new EverywhereRoutes({ projects, served, servedAt, log });

	/** The served project that holds conversation `id`, or null for none. */
	const holding = async (id: string): Promise<Served | null> => {
		for (const settled of await Promise.allSettled(served.values())) {
			const project = settled.status === "fulfilled" ? settled.value : null;
			if (
				project?.conversations &&
				(await project.conversations.find(id).then(
					() => true,
					() => false,
				))
			) {
				return project;
			}
		}
		return null;
	};

	// A conversation is the project's it started in, whichever the page is on:
	// the agent's own `splates` names no project when it says it moved. One
	// of a project not served yet is found once every one is.
	const owned =
		(pick: (project: Served) => Handler) =>
		(request: Request): Promise<Response> =>
			guarded(async (request) => {
				const id = new URL(request.url).pathname.split("/")[3] ?? "";
				let owner = await holding(id);
				if (owner === null) {
					await everywhere.openAll();
					owner = await holding(id);
				}
				// None holds it: the project asked for refuses it, as ever.
				const project = owner ?? (await projectFor(request));
				await project.format.check();
				return pick(project)(request);
			})(request);

	const workers = givenWorkers ?? new DevWorkers(log);
	const open =
		givenOpen ??
		(async (root: string) => {
			const repository = await openRepository(deps, {
				at: root,
				migrates: true,
			});
			return { ps: deps.ps, log: deps.log, ...repository };
		});
	if (
		(coordinator?.roots.length ?? 0) > 0 ||
		(coordinator?.terminals.length ?? 0) > 0
	) {
		workers.takingBack();
	}
	// Every project's records move forward before the server listens; one
	// that fails is the page's to show, and opens a terminal at its root.
	const migrations = new Migrations({
		fs,
		ps,
		log,
		projects,
		reopen: servedAt,
	});
	const terminals = new Terminals(
		gate,
		shell,
		{ projectFor, unopened: (request) => migrations.rootFor(request) },
		workers.local,
	);
	// Before the worker joins, whose hello says which it kept.
	terminals.takeBack(coordinator?.terminals ?? []);
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
			storage: FsStorage.ofMachine({ fs, ps, log }),
			projects,
			served: { served, servedAt, projectNamed },
			terminals,
			machine: worker ?? new LocalWorkerMachine(ps, fs),
			server: disposer,
			handOver: async () => {
				const roots: string[] = [];
				for (const [root, opened] of served) {
					const project = await opened.catch(() => null);
					if (await project?.conversations?.detachAsync()) {
						roots.push(root);
					}
				}
				await coordinator?.write(roots, terminals.handOver());
				await workers.detach();
			},
		},
		versions,
		{ exit, open, servers, deadlineMs },
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
	const configFiles = new ConfigFiles(fs);
	const machineStorage = FsStorage.ofMachine({ fs, ps, log });
	// Read at each request, so a project that adds `evals` to its config
	// shows its Evals page, and runs them, without a restart.
	const evalCommandsOf = async (request: Request) => {
		const project = await projectFor(request);
		return projectEvalCommands(
			ps,
			project.root,
			(await configFiles.read(project.root)).evals ?? null,
		);
	};
	const evals = new EvalRoutes({
		directory: async (request) =>
			(await evalCommandsOf(request))?.results ?? null,
	});
	const evalLaunches = new EvalLaunches(ps, machineStorage);
	disposer.use(evalLaunches);
	// The agent whose card started a run hears it is done, with its report,
	// to take the person through what to do next.
	const unwatch = evalLaunches.events.on(
		"finished",
		({ launch, results, conversation }) => {
			void (async () => {
				const text = await evals.donePrompt(results, launch.batch ?? "");
				let owner = await holding(conversation);
				if (owner === null) {
					await everywhere.openAll();
					owner = await holding(conversation);
				}
				if (owner?.conversations == null) {
					return;
				}
				const told = await owner.conversations.find(conversation);
				if (text === null) {
					told.evaluate(false);
					return;
				}
				// Its turn on the report takes over from the run, with no wait between.
				const prompting = told.prompt(text, [], undefined, {
					told: SERVER_TOLD,
				});
				told.evaluate(false);
				await prompting;
			})().catch((error: unknown) => log.error(String(error)));
		},
	);
	disposer.defer(async () => unwatch());
	// Its row shows it at work while the run goes, not waiting on its card.
	const unwatchRunning = evalLaunches.events.on(
		"running",
		({ conversation, running }) => {
			void (async () => {
				let owner = await holding(conversation);
				if (owner === null) {
					await everywhere.openAll();
					owner = await holding(conversation);
				}
				const found = await owner?.conversations
					?.find(conversation)
					.catch(() => null);
				found?.evaluate(running);
			})().catch((error: unknown) => log.error(String(error)));
		},
	);
	disposer.defer(async () => unwatchRunning());
	const evalLaunchRoutes = new EvalLaunchRoutes(
		evalLaunches,
		{ commandsOf: evalCommandsOf },
		{
			cwdOf: async (id) => {
				const owner = await holding(id);
				const conversation = await owner?.conversations
					?.find(id)
					.catch(() => null);
				return conversation?.cwd ?? null;
			},
		},
	);
	const evalCommands = await Promise.all(
		(await projects.list()).map(async (project) =>
			project.gone
				? null
				: projectEvalCommands(
						ps,
						project.root,
						(await configFiles.read(project.root)).evals ?? null,
					),
		),
	);
	await Promise.all(
		evalCommands.flatMap((commands) =>
			commands === null
				? []
				: [
						evalLaunches
							.resume([commands])
							.catch((error: unknown) =>
								log.error(
									`resuming evals at ${commands.root}: ${String(error)}`,
								),
							),
					],
		),
	);

	// Every project's, to each device that subscribed, whichever page it was on.
	const pushes = await Pushes.start({
		storage: FsStorage.ofMachine({ fs, ps, log }),
		log,
		projects,
		served,
		pusher,
	});
	disposer.defer(async () => pushes.dispose());
	const cascades = new Cascades({
		storage: machineStorage,
		fs,
		log,
		plan: async (slug, bump) =>
			planShip(await registeredGraph({ projects, fs, log }), slug, bump),
		reach: projectNamed,
	});
	disposer.defer(async () => cascades.dispose());
	// A cascade the server stopped in the middle of carries on as it serves again.
	void cascades
		.resume()
		.catch((error: unknown) =>
			log.error(`resuming the ship cascade: ${error}`),
		);
	const cascadeRoutes = new CascadeRoutes(cascades, async (request) =>
		context.everywhere.slug((await projectFor(request)).root),
	);
	const ledger = new Spend(machineStorage);
	const billing = new BillingRoutes(
		machineStorage,
		ledger,
		(name) => (deps.secrets ?? SYSTEM_STORES).device.get(name),
		{
			...(deps.fetch === undefined ? {} : { fetcher: deps.fetch }),
			plans: () =>
				readPlans(fs, ps.env("HOME") ?? homedir(), {
					kimi: {
						home:
							ps.env("KIMI_CODE_HOME") ??
							`${ps.env("HOME") ?? homedir()}/.kimi-code`,
						baseUrl: ps.env("KIMI_CODE_BASE_URL"),
						...(deps.fetch === undefined ? {} : { fetcher: deps.fetch }),
					},
				}),
		},
	);

	// Not any project's: every page on this server shares one machine.
	const machine = new Machine(
		sensors ??
			new OsSensors(fs, { ps, supervised: ps.env(SERVING) !== undefined }),
	);
	const opencode = new OpenCodeSetupRoutes(
		new OpenCodeSetup({
			fs,
			ps,
			home: splatesHome(ps),
			roster: async () => {
				const agents = await Roster.in(
					new FsStorage(splatesHome(ps), fs),
				).agents();
				for (const opened of served.values()) {
					const project = await opened.catch(() => null);
					project?.conversations?.refreshRoster(agents);
				}
			},
		}),
	);
	// Setup is the machine's, but for the steps that read the repository of
	// the project the page is on.
	const setup = new SetupRoutes(async (request) => {
		const slug = new URL(request.url).searchParams.get("project") ?? "";
		const project =
			slug === ""
				? await projects.focused()
				: (await projects.list()).find((each) => each.slug === slug);
		return new Setup(
			{
				fs,
				ps,
				home: splatesHome(ps),
				device: (deps.secrets ?? SYSTEM_STORES).device,
				opencode: opencode.setup,
				fetch: deps.fetch,
				workers: async () =>
					(
						(await workers
							.list()
							.then((response) => response.json())) as WorkerPool
					).workers,
				removeWorker: async (id) => {
					const response = await workers.remove(
						new Request(
							`http://localhost/api/workers/${encodeURIComponent(id)}`,
							{ method: "DELETE" },
						),
					);
					if (!response.ok) {
						throw new Error(`worker ${id} was not removed`);
					}
				},
				removeTunnel:
					project == null
						? undefined
						: async () => {
								const { creds } =
									opened.find((each) => each.git.root === project.root) ??
									(await open(project.root));
								const device = (deps.secrets ?? SYSTEM_STORES).device;
								await tunnelRemove({
									saved: SavedTunnel.in(
										new FsStorage(`${splatesHome(ps)}`, fs),
										device,
									),
									slots: SLOT_POOL.map(({ word }) =>
										SavedTunnel.in(
											new FsStorage(`${splatesHome(ps)}/slots/${word}`, fs),
											device,
										),
									),
									creds,
									task: null,
									fs,
									log,
									fetch: deps.fetch,
								});
							},
				project:
					project == null
						? undefined
						: setupProjectAt(
								project.root,
								{ fs, ps },
								{
									replica: async () => (await servedAt(project.root)).replica(),
									kept: async (name) =>
										(await servedAt(project.root)).kept(name),
								},
							),
			},
			SETUP_AREAS,
		);
	});

	const autoPickRules = new AutoPickRulesRoutes({ fs, home: splatesHome(ps) });
	const evalAgents = new EvalAgentsRoutes({ fs, home: splatesHome(ps) });

	disposer.defer(() => workers.disposeAsync());
	const taskPorts = new DevTaskPorts({
		worker: () => workers.local,
		owners: () => portOwnersOf(served),
		base: portsHost,
		access: gate.access,
		log,
	});

	// The port was free when `ports` scenariod it, not necessarily when it binds,
	// so a bind lost to someone else's asks again, which moves on past it.
	let requested = await ports.get();
	const listen = (): ReturnType<typeof Bun.serve<Connection>> =>
		Bun.serve<Connection>({
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
			routes: claimedFirst(
				{
					...pages.routes(),
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
					"/api/projects/:slug/grants": { PUT: guarded(picker.grant) },
					"/api/focus": { PUT: guarded(picker.focus) },
					"/api/stats": guarded(ended.stats),
					"/api/auto-pick/overrides": guarded(ended.overrides),
					"/api/evals": guarded(evals.list),
					"/api/evals/agents": {
						GET: guarded(evalAgents.read),
						PUT: guarded(evalAgents.save),
					},
					"/api/evals/batch": guarded(evals.batch),
					"/api/evals/run": guarded(evals.run),
					"/api/evals/scenarios": guarded(evalLaunchRoutes.scenarios),
					"/api/evals/plan": { POST: guarded(evalLaunchRoutes.plan) },
					"/api/evals/launch": {
						GET: guarded(evalLaunchRoutes.read),
						POST: guarded(evalLaunchRoutes.start),
						DELETE: guarded(evalLaunchRoutes.stop),
					},
					"/api/identity": guarded(async (request) =>
						Response.json({
							email: (await gate.identity(request))?.email ?? null,
						}),
					),
					// Every project's, as the ledger is the machine's.
					"/api/spend": guarded(billing.spend),
					"/api/billing": guarded(billing.read),
					"/api/billing/pull": { POST: guarded(billing.pull) },
					"/api/billing/currency": { PUT: guarded(billing.setCurrency) },
					"/api/machine": guarded(async () =>
						Response.json({
							...(await machine.read()),
							queue: queueListing(workers.placement.scheduler.queue()),
							// The machine's, as a merge under way is, so every page shows it.
							ship: await cascades.shown().catch((error: unknown) => {
								log.error(`reading the ship cascade: ${error}`);
								return { cascade: null, ship: null };
							}),
						}),
					),
					// Through a tunnel only once Access verified who is asking, as a
					// conversation is: what an agent said goes to the device.
					"/api/push": talk(guarded(pushes.key)),
					"/api/push/subscription": {
						PUT: talk(guarded(pushes.subscribe)),
						DELETE: talk(guarded(pushes.unsubscribe)),
					},
					"/api/setup/opencode/disable": {
						POST: local(guarded(opencode.disable)),
					},
					"/api/setup/opencode/conversation": {
						POST: local(
							scoped(
								(project) => async (request) =>
									opencode.conversation(project.root, (selection) =>
										project.startConversation(
											new Request(request.url, {
												method: "POST",
												headers: { "content-type": "application/json" },
												body: JSON.stringify({
													agent: "opencode",
													model: selection.model,
													task: null,
													assigned: true,
												}),
											}),
										),
									),
							),
						),
					},
					"/api/setup": guarded(setup.read),
					"/api/setup/seen": { PUT: guarded(setup.see) },
					"/api/setup/:step/next": { POST: guarded(setup.next) },
					"/api/setup/:area/undo": {
						GET: guarded(setup.undoPlan),
						POST: guarded(setup.undo),
					},
					"/api/auto-pick/rules": {
						GET: guarded(autoPickRules.read),
						PUT: guarded(autoPickRules.save),
					},
					"/api/auto-pick/rules/reset": {
						POST: guarded(autoPickRules.reset),
					},
					// It may ask the judge, on the person's key, as a start would.
					"/api/auto-pick/try": {
						POST: talk(scoped((project) => project.tryAutoPick)),
					},
					"/api/migration": guarded(migrations.read),
					"/api/migration/retry": { POST: guarded(migrations.retry) },
					"/api/restart": { POST: talk(guarded(restartIdle)) },
					"/api/power": { POST: talk(guarded(powerNow)) },
					"/api/checkpoint": { POST: talk(guarded(checkpointProjects)) },
					"/api/projects/:slug": { DELETE: guarded(forgetProject) },
					"/api/snapshot": scoped((project) => project.snapshot),
					// Conversations among them, so only as far as a conversation reaches.
					"/api/everywhere": talk(guarded(everywhere.list)),
					"/api/everywhere/events": talk(guarded(everywhere.events)),
					"/api/file": scoped((project) => project.file),
					// Limited to what a conversation reaches, since it runs the person's editor.
					"/api/open": { POST: talk(scoped((project) => project.open)) },
					"/api/paths": scoped((project) => project.paths),
					"/api/tasks/:task/diff": scoped((project) => project.diff),
					"/api/tasks/:task/merge-output/:index": scoped(
						(project) => project.mergeOutput,
					),
					"/api/ship": {
						GET: scoped((project) => project.ship),
						// It publishes under the person's npm sign-in, so only as
						// far as a conversation reaches.
						POST: talk(guarded(cascadeRoutes.startCascade)),
					},
					"/api/ship/plan": guarded(cascadeRoutes.plan),
					// Who pins whose packages, the tree the Ship page ships from.
					"/api/ship/graph": guarded(async () =>
						Response.json(await registeredGraph({ projects, fs, log })),
					),
					"/api/ship/cascade": {
						GET: guarded(cascadeRoutes.cascade),
						PATCH: talk(guarded(cascadeRoutes.reviseCascadeBump)),
					},
					// It adds a queued task, so only as far as a conversation reaches.
					// It stops a publish and removes tasks, so only as far as a
					// conversation reaches.
					"/api/ship/cascade/abandon": {
						POST: talk(guarded(cascadeRoutes.abandonCascade)),
					},
					"/api/ship/events": guarded(cascadeRoutes.cascadeEvents),
					"/api/ship/history": guarded(cascadeRoutes.history),
					"/api/ship/history/:id": guarded(cascadeRoutes.historyEntry),
					"/api/ship/history/:id/log": guarded(cascadeRoutes.historyLog),
					"/api/ship/output": scoped((project) => project.shipOutput),
					"/api/finished": scoped((project) => project.finishedTasks),
					"/api/merge-estimates": scoped((project) => project.mergeEstimates),
					"/api/finished/:key": scoped((project) => project.finishedTask),
					"/api/tasks/:task/outcome": scoped((project) =>
						ended.landed(project.root),
					),
					"/api/tasks/:task/retry": {
						POST: scoped((project) => project.retryTask),
					},
					"/api/tasks/:task": {
						DELETE: talk(scoped((project) => project.removeTask)),
					},
					"/api/todos": { POST: scoped((project) => project.addQueued) },
					"/api/todos/:id": {
						PATCH: scoped((project) => project.updateQueued),
						DELETE: scoped((project) => project.removeQueued),
					},
					"/api/todos/:id/restore": {
						POST: scoped((project) => project.restoreQueued),
					},
					"/api/todos/:id/position": {
						PUT: scoped((project) => project.moveQueued),
					},
					"/api/todos/:id/blocked-by": {
						PUT: scoped((project) => project.linkQueued),
					},
					"/api/elsewhere/tasks": {
						GET: scoped((project) => project.elsewhereTasks),
					},
					"/api/todos/:id/lane": {
						PUT: scoped((project) => project.arrangeQueued),
					},
					"/api/todos/:id/assignee": {
						PUT: scoped((project) => project.assignQueued),
					},
					"/api/todos/:id/queued": {
						PUT: scoped((project) => project.queueQueued),
					},
					"/api/todos/:id/deferral/answer": {
						PUT: scoped((project) => project.answerDeferred),
					},
					"/api/todos/:id/deferral/outside": {
						PUT: scoped((project) => project.doneOutside),
					},
					"/api/todos/:id/queue-position": {
						PUT: scoped((project) => project.moveInQueue),
					},
					"/api/todos/:id/retry": {
						POST: scoped((project) => project.retryQueued),
					},
					"/api/lanes/:id/join": {
						POST: scoped((project) => project.joinLane),
					},
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
					// Through a tunnel only once Access verified who is asking: an
					// agent automation spends its person's tokens.
					"/api/automations": {
						GET: talk(scoped((project) => project.listAutomations)),
						POST: talk(scoped((project) => project.addAutomation)),
					},
					"/api/automations/:id": {
						PUT: talk(scoped((project) => project.editAutomation)),
						DELETE: talk(scoped((project) => project.removeAutomation)),
					},
					"/api/automations/:id/pause": {
						PUT: talk(scoped((project) => project.pauseAutomation)),
						DELETE: talk(scoped((project) => project.resumeAutomation)),
					},
					"/api/automations/:id/run": {
						POST: talk(scoped((project) => project.runAutomation)),
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
					"/api/conversations/auto": {
						POST: talk(scoped((project) => project.startAutoPick)),
					},
					"/api/conversations/sessions": {
						GET: talk(scoped((project) => project.listSessions)),
						POST: talk(scoped((project) => project.bringSession)),
					},
					"/api/conversations/defaults": {
						PUT: talk(scoped((project) => project.chooseDefault)),
					},
					"/api/conversations/limits": {
						POST: talk(scoped((project) => project.refreshLimits)),
					},
					"/api/conversations/events": talk(
						scoped((project) => project.conversationEvents),
					),
					"/api/conversations/:id": {
						GET: talk(owned((project) => project.showConversation)),
					},
					"/api/conversations/:id/prompt": {
						POST: talk(owned((project) => project.promptConversation)),
					},
					"/api/conversations/:id/suite": {
						POST: talk(owned((project) => project.approveSuite)),
					},
					"/api/conversations/:id/attachments/:name": {
						GET: talk(owned((project) => project.conversationAttachment)),
					},
					"/api/conversations/:id/artifacts/:name/:version": {
						GET: talk(owned((project) => project.conversationArtifact)),
						DELETE: talk(owned((project) => project.deleteArtifactVersion)),
					},
					"/api/conversations/:id/artifacts": {
						POST: talk(owned((project) => project.addArtifact)),
					},
					"/api/conversations/:id/artifacts/:name": {
						DELETE: talk(owned((project) => project.removeArtifact)),
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
					"/api/conversations/:id/restart": {
						POST: talk(owned((project) => project.restartConversation)),
					},
					"/api/conversations/:id/hand-off": {
						POST: talk(owned((project) => project.handOffConversation)),
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
					"/api/conversations/:id/auto-pick": {
						PUT: talk(owned((project) => project.switchAutoPick)),
					},
					"/api/conversations/:id/archived": {
						PUT: talk(owned((project) => project.archiveConversation)),
					},
					"/api/conversations/:id/unread": {
						PUT: talk(owned((project) => project.markUnread)),
					},
					"/api/conversations/:id/read": {
						PUT: talk(owned((project) => project.markRead)),
					},
					"/api/conversations/:id/pinned": {
						PUT: talk(owned((project) => project.pinConversation)),
					},
					"/api/conversations/:id/parent": {
						PUT: talk(owned((project) => project.reparentConversation)),
					},
					"/api/conversations/:id/name": {
						PUT: talk(owned((project) => project.renameConversation)),
					},
					"/api/conversations/:id/task": {
						PUT: talk(owned((project) => project.moveConversation)),
					},
					"/api/ports": guarded(taskPorts.list),
					"/api/queue": guarded(workers.queue),
					"/api/queue/:id/position": {
						PUT: talk(guarded(workers.moveQueued)),
					},
				},
				taskPorts,
			),
			websocket: CONNECTIONS,
			// Here rather than among the routes, since only here may a request be
			// answered with an upgrade instead of a response.
			fetch: (request, server) => {
				const claimed = taskPorts.claim(request, server);
				if (claimed !== null) {
					return claimed;
				}
				const { pathname } = new URL(request.url);
				if (pathname === "/api/terminal") {
					return terminals.open(request, server);
				}
				if (pathname === "/api/dictation") {
					return dictations.open(request, server);
				}
				if (pathname === "/api/workers") {
					return guarded(workers.list)(request);
				}
				if (pathname.startsWith("/api/workers/")) {
					return workers.manage(request, (handle) => talk(guarded(handle)));
				}
				return new Response("not found", { status: 404 });
			},
		});
	// Before the page can ask for a project whose records are still moving.
	await migrations.startAll();
	let server = null as ReturnType<typeof listen> | null;
	for (let attempt = 1; server === null; attempt++) {
		try {
			server = listen();
		} catch (error) {
			if (!isAddressInUse(error) || attempt >= BIND_ATTEMPTS) {
				throw error;
			}
			requested = await ports.get();
		}
	}
	// Read back, because `ports` may hand over 0 to mean any port at all, and
	// read now, because `server.port` is 0 once the server is stopped and this is
	// handed to a caller that stops it. Undefined only for a unix socket, which
	// this never asks for.
	const port = server.port ?? requested;
	url = `http://${LOOPBACK}:${port}`;
	// Open now, so the page's first request finds it ready; one that fails
	// says so when the page asks for it.
	const focused = await projects.focused();
	if (focused !== null) {
		await servedAt(focused.root).catch((error: unknown) =>
			log.error(`${focused.root} did not open: ${String(error)}`),
		);
	}
	// And those the last run let go of agents in, whose conversations take
	// their processes back from the worker: read before it joins, since its
	// hello settles which channels live on.
	for (const root of coordinator?.roots ?? []) {
		await servedAt(root)
			.then((project) => project.conversations?.list())
			.catch((error: unknown) =>
				log.error(`${root} did not open: ${String(error)}`),
			);
	}
	// Every registered project replicates, whether or not a page opens it.
	for (const registered of await projects.list()) {
		if (!registered.gone) {
			startReplicating(registered.root);
		}
	}
	workers.serving();
	if (workerSocket !== null) {
		await workers.listen(workerSocket, fs);
	}
	// And those a restart stopped agents in, which carry on once served.
	await restarts.reopenStopped();

	log.info(`splates server on http://${LOOPBACK}:${port}`);
	// So `splates update` finds it, to restart it onto a newer splates.
	const serving = new Serving(FsStorage.ofMachine({ fs, ps, log }), ps);
	await serving.say(url, running);
	disposer.defer(() => serving.forget());
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
	disposer.defer(() => everywhere.disposeAsync());
	disposer.defer(() => replicas.disposeAsync());
	disposer.defer(async () => {
		for (const settled of await Promise.allSettled(served.values())) {
			if (settled.status === "fulfilled") {
				await settled.value.disposeAsync();
			}
		}
	});
	// Last, so it runs first: a restart under way writes before all else goes.
	disposer.defer(() => restarts.disposeAsync());
	return {
		port,
		disposeAsync: disposer.disposeAsync,
	};
}

/** A running server, and the one thing a caller ever wants to do with it. */
export interface DevServer extends AsyncResource {
	port: number;
}

/** Whether binding failed because another process holds the port. */
function isAddressInUse(error: unknown): boolean {
	return (
		error instanceof Error &&
		(error as NodeJS.ErrnoException).code === "EADDRINUSE"
	);
}
