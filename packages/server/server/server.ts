// scry-ignore-file compact-files: the dev server and its route table, each body handed to its own module
import { dirname, join } from "node:path";
import { AsyncDisposer, type AsyncResource } from "webappwiz/disposable";
import { Duration } from "webappwiz/time";
import { AutoPickRulesRoutes } from "../auto-pick";
import { SYSTEM_STORES } from "../creds";
import { Dictations, transcriberFor } from "../dictate";
import {
	EvalAgentsRoutes,
	EvalLaunches,
	EvalLaunchRoutes,
	EvalRoutes,
} from "../evals";
import { fail } from "../exit";
import { Roster, splatesHome } from "../models";
import { RESUME } from "../plans";
import { claimedFirst, DevTaskPorts, portOwnersOf, SLOT_POOL } from "../ports";
import { Everywhere, EverywhereRoutes, Picker } from "../projects";
import { Pushes } from "../push";
import { openRepository } from "../records";
import {
	CoordinatorMoveRoutes,
	OpenCodeSetup,
	OpenCodeSetupRoutes,
	SETUP_AREAS,
	Setup,
	SetupRoutes,
	setupProjectAt,
} from "../setup";
import { BillingRoutes, Spend } from "../spend";
import { DevOutcomes } from "../stats";
import { FsStorage } from "../storage";
import { rescueStranded } from "../tasks";
import { Terminals } from "../terminal";
import { Access, SavedTunnel, startTunnel, tunnelRemove } from "../tunnel";
import {
	alertNotice,
	DevWorkers,
	LocalWorkerMachine,
	Machine,
	osSensors,
	queueListing,
	WORKER_SOCKET_PATH,
	WorkerBudgetRoutes,
	type WorkerPool,
	workerBudgetReport,
} from "../workers";
import { heavyJobsOfMachine } from "./heavy";
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
import { RUNNING, sourceCommit } from "./release";
import { Restarts } from "./restart";
import { Serving } from "./serving";
import { CONNECTIONS, type Connection } from "./sockets";
import { StateRoutes } from "./state";
import { Versions } from "./versions";

export type { DevOptions } from "./options";
export { DEFAULT_PORT, devPorts, PORT_SPAN } from "./ports";

/** How many times `dev` binds before it gives up on a port that keeps being taken. */
const BIND_ATTEMPTS = 5;

/**
 * Serves what `task list`, `list` and `show` print as one page that refetches
 * when the repo changes, where a person adds, edits, reorders and removes
 * queued tasks. Anything that moves a started task (merge, claim) stays in
 * the CLI, and removing one answers only to this machine's own names, so a page that
 * should not have been reachable can at worst change a queued task.
 *
 * Given `conversations`, the page also talks to agents, which run commands on
 * this machine. Those routes answer only to this machine's own names, or,
 * given `access`, to a host `hosts` lets in once Cloudflare Access verified
 * who is asking; without it, a tunnel still reaches no further than the queued tasks.
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
		checkEvery = Duration.mins(60), // how often to ask npm for a newer splates
		source = async () => null,
		sourceEvery = Duration.secs(15), // so a commit in a checkout shows within seconds
		unbuilt = false,
		slot = null,
		servers = async () => [],
		exit = null,
		deadlineMs,
		sensors = null,
		heavy = null,
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
		conversationsFor: ({ splatesDir, storage, git, service, creds, journal }) =>
			converse?.({
				splatesDir,
				storage,
				git,
				config: service.config,
				creds,
				service,
				journal,
			}) ?? null,
		transcriberFor: transcriber,
		everywhere: Everywhere.served(served, projects),
		// Read once serving, after the workers are made below.
		workerRoom: () => workers.slots.scheduler.room(),
		onWorkerRoom: (listener) =>
			workers.slots.scheduler.events.on("changed", listener),
		wantWorkers: (root, requests) =>
			workers.slots.scheduler.want(root, requests),
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

	const state = new StateRoutes({
		ps,
		projects,
		named: projectNamed,
		at: servedAt,
	});

	const workers = givenWorkers ?? new DevWorkers(log);
	// A call through an agent's relay reaches its own project alone: the
	// connection it came in on says which.
	const limited =
		(handle: (request: Request, limit: string | null) => Promise<Response>) =>
		(request: Request, server: Bun.Server<Connection>) =>
			talk(
				guarded((each) =>
					handle(
						each,
						workers.registry.scopes.of(server.requestIP(request)?.port),
					),
				),
			)(request);
	// Each project reads a task cloned on a worker through that worker.
	const open =
		givenOpen ??
		(async (root: string) => {
			const repository = await openRepository(deps, {
				at: root,
				migrates: true,
				machines: workers,
			});
			// A worker back from being away has commits its tasks went on without.
			workers.joined((machine) => {
				void rescueStranded(machine, {
					service: repository.service,
					machines: workers,
					branches: repository.branches,
					log: deps.log,
				}).catch((error: unknown) => deps.log.error(String(error)));
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
	const evalsCheckout =
		(await sourceCommit(ps)) === null
			? null
			: dirname(dirname(dirname(import.meta.dirname)));
	const evals = new EvalRoutes({ ps, checkout: evalsCheckout });
	const evalLaunches =
		evalsCheckout === null
			? null
			: new EvalLaunches({
					ps,
					checkout: evalsCheckout,
					directory: join(splatesHome(ps), "probe-evals"),
				});
	if (evalLaunches !== null) {
		disposer.defer(async () => evalLaunches.dispose());
	}
	const evalLaunchRoutes = new EvalLaunchRoutes(evalLaunches);

	// Every project's, to each device that subscribed, whichever page it was on.
	const pushes = await Pushes.start({
		storage: FsStorage.ofMachine({ fs, ps, log }),
		log,
		projects,
		served,
		pusher,
	});
	disposer.defer(async () => pushes.dispose());
	const machineStorage = FsStorage.ofMachine({ fs, ps, log });
	const ledger = new Spend(machineStorage);
	const billing = new BillingRoutes(
		machineStorage,
		ledger,
		(name) => (deps.secrets ?? SYSTEM_STORES).device.get(name),
		deps.fetch,
	);
	const budget = new WorkerBudgetRoutes(
		workers.provisioning?.budget ?? null,
		workers.slots.scheduler,
		workers.provisioning,
	);
	// Loud, whatever a device asks to hear: a limit nearing costs money.
	workers.provisioning?.events.on("alert", (alert) => {
		void pushes.announce({ ...alertNotice(alert), url: "#billing" });
	});
	// A reached limit stops the agents on made workers at their checkpoint.
	workers.provisioning?.events.on("stopping", ({ reason, held }) => {
		void (async () => {
			for (const root of new Set(held.map((each) => each.project))) {
				const project = await servedAt(root).catch(() => null);
				await project?.checkpoint(
					held.filter((each) => each.project === root).map((each) => each.id),
					reason,
				);
			}
			log.info(`${reason}: asked the agents on made workers to checkpoint`);
		})();
	});
	// Once it allows again, each carries on where it stopped, queued for a
	// slot as any agent is, unless the person has said something since.
	workers.provisioning?.events.on("carrying", ({ held }) => {
		for (const { project: root, conversation: id } of held) {
			void (async () => {
				const project = await servedAt(root).catch(() => null);
				const conversation = await project?.conversations
					?.find(id)
					.catch(() => null);
				if (conversation == null) {
					return;
				}
				await conversation.answered();
				const { budgetStop, checkpoint } = conversation.state;
				if (budgetStop === null) {
					return;
				}
				if (checkpoint === "done") {
					await conversation
						.prompt(RESUME)
						.catch(() => conversation.dismissCheckpoint());
				} else {
					conversation.dismissCheckpoint();
				}
			})();
		}
	});

	// Not any project's: every page on this server shares one machine.
	const machine = new Machine(sensors ?? osSensors(fs));
	const jobs = heavy ?? heavyJobsOfMachine({ fs, ps, log });
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
		const budget = workers.provisioning?.budget;
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
				workerBudget:
					budget === undefined
						? undefined
						: {
								report: async () => ({
									standing: budget.standing(),
									reviewed: budget.reviewed,
								}),
								set: (limit, amount) => budget.set(limit, amount),
								unreview: () => budget.unreview(),
							},
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
				removeWorkerKeys: async (provider) => {
					const keys = workers.keys;
					if (keys === null) {
						return;
					}
					for (const { holder } of keys.all) {
						await keys.remove(holder, provider);
					}
					await workers.delivery.resend();
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
						: setupProjectAt(project.root, { fs, ps }),
			},
			SETUP_AREAS,
		);
	});

	const autoPickRules = new AutoPickRulesRoutes({ fs, home: splatesHome(ps) });
	const evalAgents = new EvalAgentsRoutes({ fs, home: splatesHome(ps) });

	const coordinatorMove = new CoordinatorMoveRoutes({
		fs,
		ps,
		home: splatesHome(ps),
		device: (deps.secrets ?? SYSTEM_STORES).device,
		dev: () => url,
	});

	disposer.defer(() => workers.disposeAsync());
	const taskPorts = new DevTaskPorts({
		workers: () => workers.registry.workers,
		owners: () => portOwnersOf(served),
		base: portsHost,
		access: gate.access,
		log,
	});
	disposer.defer(async () => taskPorts.dispose());

	// The port was free when `ports` probed it, not necessarily when it binds,
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
					"/api/evals/probes": guarded(evalLaunchRoutes.probes),
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
							heavy: await jobs.read(),
							queue: queueListing(workers.slots.scheduler.queue()),
							workerBudget:
								workers.provisioning === null
									? null
									: workerBudgetReport(
											workers.provisioning.budget,
											workers.slots.scheduler,
											workers.provisioning.offer(),
										),
						}),
					),
					"/api/worker-budget": guarded(budget.show),
					"/api/worker-budget/raises": { POST: talk(guarded(budget.raise)) },
					"/api/worker-budget/raises/:id": {
						DELETE: talk(guarded(budget.endRaise)),
					},
					"/api/worker-budget/:limit": { PUT: talk(guarded(budget.set)) },
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
					// It stops this server: from a page Access let in alone.
					"/api/setup/coordinator/move": {
						GET: guarded(coordinatorMove.progress),
						POST: talk(guarded(coordinatorMove.start)),
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
					// It runs the person's editor, so only as far as a conversation reaches.
					"/api/open": { POST: talk(scoped((project) => project.open)) },
					"/api/paths": scoped((project) => project.paths),
					"/api/tasks/:task/diff": scoped((project) => project.diff),
					"/api/finished": scoped((project) => project.finishedTasks),
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
					"/api/todos/:id/lane": {
						PUT: scoped((project) => project.arrangeQueued),
					},
					"/api/todos/:id/assignee": {
						PUT: scoped((project) => project.assignQueued),
					},
					"/api/todos/:id/manual": {
						PUT: scoped((project) => project.manualQueued),
					},
					"/api/todos/:id/queued": {
						PUT: scoped((project) => project.queueQueued),
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
					"/api/notes": { GET: scoped((project) => project.listNotes) },
					"/api/notes/read": { GET: scoped((project) => project.readNote) },
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
					// Through a worker's relay, which reaches only this machine's
					// names: the records of a project its commands run on.
					"/api/state": { POST: limited(state.answer) },
					// And a merge there holding the lease, which only this end
					// lands on trunk.
					"/api/land": { POST: limited(state.land) },
					"/api/queue": guarded(workers.queue),
					"/api/queue/:id/position": {
						PUT: talk(guarded(workers.moveQueued)),
					},
					"/api/token": { POST: limited(state.token) },
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
					return workers.route(request, server, guarded);
				}
				if (pathname === WORKER_SOCKET_PATH) {
					return workers.open(request, server);
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
	workers.serving(port);
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
