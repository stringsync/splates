import { homedir } from "node:os";
// vet-ignore-file compact-files: the dev server and its route table, each body handed to its own module

import { AsyncDisposer, type AsyncResource } from "core/disposable";
import { Duration, SystemTimer } from "core/time";
import { AutopickRulesRoutes, HealthRoutes } from "../autopick";
import { TaskStore, Tasks } from "../board";
import { ConfigFiles } from "../config";
import { SYSTEM_STORES } from "../creds";
import { D2Renderer, DiagramRoutes } from "../diagrams";
import { Dictations, transcriberFor } from "../dictate";
import { fail } from "../exit";
import { Limits, splatesHome } from "../models";
import {
	claimedFirst,
	DevTaskPorts,
	portOwnersOf,
	rigProxyTargetsOf,
	SLOT_POOL,
	Slots,
} from "../ports";
import { Everywhere, EverywhereRoutes, GENERAL, Picker } from "../projects";
import { Pushes } from "../push";
import { Rec } from "../rec";
import { OpenBoards, openRepository, ProjectHome } from "../records";
import { RigSlots } from "../rigs";
import { SETUP_AREAS, Setup, SetupRoutes, setupProjectAt } from "../setup";
import {
	Clocks,
	isOn,
	lastUserMessagesOf,
	Probes,
	pageKillRoute,
	QuotaSignals,
	raiseIn,
	SignalBook,
	SignalExpiration,
	type SignalFunction,
	type SignalHome,
	SignalRoutes,
	subscriptionsIn,
} from "../signals";
import { BillingRoutes, readPlans, Spend } from "../spend";
import { DevOutcomes } from "../stats";
import { FsStorage } from "../storage";
import { Terminals } from "../terminal";
import {
	pendingRuleSuggestions,
	RULE_SUGGESTIONS_DOC,
	type SuggestedFile,
	TrustRoutes,
	TrustStore,
} from "../trust";
import { Access, SavedTunnel, startTunnel, tunnelRemove } from "../tunnel";
import {
	DevWorkers,
	LocalWorkerMachine,
	Machine,
	OsSensors,
	queueListing,
	strained,
} from "../workers";
import { General } from "./general";
import { body, HostGate, LOOPBACK, MAX_BODY_BYTES } from "./http";
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
		general: generalOption = null,
		shell = null,
		transcriber = transcriberFor,
		newest = async () => null,
		running = RUNNING,
		checkEvery = Duration.mins(60), // how often to ask npm for a newer splates
		source = async () => null,
		stuck = async () => null,
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
		portsAccess = null,
		onRigSlotClaimed,
		pusher,
		open: givenOpen,
		limits: givenLimits,
	}: DevOptions = {},
): Promise<DevServer> {
	const { fs, ps, log, assets, projects, opened = [] } = deps;
	const machineStorage = FsStorage.ofMachine({ fs, ps, log });
	const trustStore = new TrustStore(machineStorage);
	const general =
		generalOption === null
			? null
			: new General(
					generalOption.conversations,
					generalOption.root,
					generalOption.scratchRoot,
					{
						fs,
						release: () => versions.release,
						behind: () => versions.behind,
						stuck: () => versions.stuck,
						unbuilt,
						slot,
						projectNamed: (slug) => projectNamed(slug),
					},
				);
	// The page is the one thing a tunnel exposes, so no tunnel runs unguarded.
	if (tunnel !== null && access === null) {
		fail(
			"usage",
			"a tunnel needs Cloudflare Access in front: give --access-team and --access-aud",
			{ host: tunnel.host },
		);
	}
	// A task's server is reached as the page is, so never without Access.
	if (portsHost !== null && (portsAccess ?? access) === null) {
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
	const devSlots = Slots.ofMachine({ fs, ps, log });
	const rigSlots = RigSlots.in(machineStorage, {
		exists: (path) => fs.exists(path),
		reserved: () => devSlots.heldWords(),
	});
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
		get stuck() {
			return versions.stuck;
		},
		unbuilt,
		slot,
		conversationsFor: ({ dir, storage, git, service, creds, journal }) => {
			const conversations =
				converse?.({
					dir,
					storage,
					git,
					config: service.config,
					creds,
					service,
					journal,
				}) ?? null;
			return conversations;
		},
		transcriberFor: transcriber,
		everywhere: Everywhere.served(served, projects),
		trust: trustStore,
		boards: new OpenBoards({ fs, ps, log }, projects),
		portsBase: portsHost,
		rigSlots,
		onRigSlotClaimed,
		shipLauncher: {
			launch: (argv, cwd, env) => workers.local.launch(argv, cwd, env),
			resume: (handle, held) => workers.local.resume(handle, held),
		},
		onWorkerRoom: (listener) =>
			workers.placement.scheduler.events.on("changed", listener),
		paused: () => workers.records.paused,
		raiseSignal: async (name, by, payload) => {
			await signals.announce(name, by, payload);
		},
		clockShelf: () => signalHome.book,
		signalTasks: {
			raises: () => signalHome.book.raises(),
			subscribed: (name) => probes.subscribed(name),
		},
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

	const talkingFor = async (request: Request): Promise<Served | General> => {
		if (
			general !== null &&
			new URL(request.url).searchParams.get("project") === GENERAL
		) {
			return general;
		}
		return projectFor(request);
	};
	const conversationScoped =
		(pick: (project: Served | General) => Handler) =>
		(request: Request): Promise<Response> =>
			guarded(async (request) => {
				const project = await talkingFor(request);
				if (!(project instanceof General)) {
					await project.format.check();
				}
				return pick(project)(request);
			})(request);

	// Every registered project's tasks and conversations, to one page.
	const everywhere = new EverywhereRoutes({
		projects,
		served,
		servedAt,
		...(general === null ? {} : { general }),
		log,
	});

	/** The served project or General that holds conversation `id`, or null for none. */
	const holding = async (id: string): Promise<Served | General | null> => {
		if (
			general !== null &&
			(await general.conversations.find(id).then(
				() => true,
				() => false,
			))
		) {
			return general;
		}
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
		(pick: (project: Served | General) => Handler) =>
		(request: Request): Promise<Response> =>
			guarded(async (request) => {
				const id = new URL(request.url).pathname.split("/")[3] ?? "";
				let owner = await holding(id);
				if (owner === null) {
					await everywhere.openAll();
					owner = await holding(id);
				}
				// None holds it: the project asked for refuses it, as ever.
				const project = owner ?? (await talkingFor(request));
				if (!(project instanceof General)) {
					await project.format.check();
				}
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
		stuck,
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
				await general?.conversations.detachAsync();
				const roots: string[] = [];
				for (const [root, opened] of served) {
					const project = await opened.catch(() => null);
					const conversations = await project?.conversations?.detachAsync();
					const work = await project?.detachWork();
					if (conversations || work) {
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

	const ended = new DevOutcomes(deps, {
		async ofProject(root) {
			try {
				const repository = await openRepository(deps, { at: root });
				try {
					return await repository.journal.all();
				} finally {
					repository.dispose();
				}
			} catch {
				// A project may have moved or been removed since its tasks ended.
				return [];
			}
		},
	});
	const trust = new TrustRoutes(
		trustStore,
		async (id, task) => {
			const owner = await findConversation(id);
			const state = owner?.conversations
				? (await owner.conversations.find(id)).state
				: null;
			return (
				state !== null &&
				!state.archived &&
				(task === null || state.task === task)
			);
		},
		async (onlyProject) => {
			const list = (await projects.list()).filter(
				(each) =>
					!each.gone &&
					(onlyProject === undefined || each.root === onlyProject),
			);
			if (list.length === 0) {
				return [];
			}
			const allDecisions = await trustStore.decisions({ project: onlyProject });
			const found = await Promise.all(
				list.map(async (each) => {
					const decisions = allDecisions.filter(
						(item) => item.project === each.root,
					);
					const ready = opened.find((item) => item.git.root === each.root);
					if (ready !== undefined) {
						const [boardTasks, recorded] = await Promise.all([
							ready.tasks.all(),
							ready.storage
								.document<SuggestedFile>(RULE_SUGGESTIONS_DOC)
								.read(),
						]);
						return pendingRuleSuggestions({
							project: each.root,
							slug: each.slug,
							decisions,
							tasks: boardTasks.map((task) => task.state),
							recorded,
						});
					}
					const home = new ProjectHome(each.root, { fs, ps, log, projects });
					if (!(await home.exists())) {
						return [];
					}
					try {
						const storage = await home.open();
						const [boardTasks, recorded] = await Promise.all([
							new Tasks(new TaskStore(storage)).all(),
							storage.document<SuggestedFile>(RULE_SUGGESTIONS_DOC).read(),
						]);
						return pendingRuleSuggestions({
							project: each.root,
							slug: each.slug,
							decisions,
							tasks: boardTasks.map((task) => task.state),
							recorded,
						});
					} catch {
						// A project's database may be unreadable or migrating; skip it.
						return [];
					} finally {
						home.dispose();
					}
				}),
			);
			return found
				.flat()
				.sort(
					(left, right) =>
						right.createdAt.localeCompare(left.createdAt) ||
						right.taskId - left.taskId,
				);
		},
	);
	const configFiles = new ConfigFiles(fs);

	// Every project's, to each device that subscribed, whichever page it was on.
	const rec = new Rec(ps, {
		localOrigin: () =>
			url === null ? null : url.replace(LOOPBACK, "localhost"),
		logSources: {
			find: async (request) => {
				const { root } = await projectFor(request);
				return { root, rec: (await configFiles.read(root)).rec };
			},
		},
	});
	const pushes = await Pushes.start({
		storage: FsStorage.ofMachine({ fs, ps, log }),
		log,
		projects,
		served,
		pusher,
	});
	disposer.defer(async () => pushes.dispose());
	// What agents raise and wait on, across every project the server holds.
	const allConversations = async (open = true) => {
		if (open) {
			await everywhere.openAll();
		}
		const found = [
			...((await general?.conversations.list().catch(() => [])) ?? []),
		];
		for (const settled of await Promise.allSettled(served.values())) {
			if (settled.status === "fulfilled" && settled.value.conversations) {
				found.push(...(await settled.value.conversations.list()));
			}
		}
		return found;
	};
	const ledger = new Spend(machineStorage);
	const limits =
		givenLimits ?? new Limits(machineStorage.document("limits.json"));
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
			limits: () => limits.history(),
		},
	);

	// Not any project's: every page on this server shares one machine.
	const machine = new Machine(
		sensors ??
			new OsSensors(fs, { ps, supervised: ps.env(SERVING) !== undefined }),
	);
	// Signals, and the probes that raise them, across every project.
	const findConversation = async (id: string) => {
		let owner = await holding(id);
		if (owner === null) {
			await everywhere.openAll();
			owner = await holding(id);
		}
		return owner;
	};
	let expiration: SignalExpiration | undefined;
	const signalHome: Pick<SignalHome, "book" | "all" | "fire" | "now"> &
		Pick<SignalHome, "setExpiration"> = {
		book: new SignalBook(machineStorage.document("signals.json"), () =>
			Date.now(),
		),
		now: () => Date.now(),
		all: allConversations,
		fire: async (name: string, by: string, payload: unknown) => {
			for (const settled of await Promise.allSettled(served.values())) {
				if (settled.status === "fulfilled") {
					await settled.value
						.signalRaised(name, by, payload)
						.catch((error: unknown) => log.error(String(error)));
				}
			}
		},
		setExpiration: async (name, at) => {
			await expiration?.set(name, at);
		},
	};
	const probes = new Probes({
		book: signalHome.book,
		shell: (script, cwd, timeoutMs) =>
			ps.spawnCapture(["sh", "-c", script], { cwd, timeoutMs }),
		busy: async () => strained(await machine.read()),
		raise: async (name, by, payload) => {
			await raiseIn(signalHome, name, by, payload);
		},
		subscriptions: async (name) => {
			let count = await subscriptionsIn(signalHome, name);
			for (const settled of await Promise.allSettled(served.values())) {
				if (settled.status === "fulfilled") {
					count += await settled.value.signalAutomations(name).catch(() => 0);
				}
			}
			return count;
		},
		remove: async (name, reason) => {
			for (const conversation of await allConversations()) {
				conversation.removeSignal(name, reason);
			}
		},
		show: async (probe) => {
			const owner = await findConversation(probe.conversation);
			(
				await owner?.conversations?.find(probe.conversation).catch(() => null)
			)?.showProbe(probe);
		},
		now: () => Date.now(),
		timer: new SystemTimer(),
		log,
	});
	disposer.defer(async () => probes.dispose());
	void probes
		.arm()
		.catch((error: unknown) => log.error(`arming probes: ${String(error)}`));
	let recoveringClocks = true;
	const clocks = new Clocks({
		book: signalHome.book,
		now: () => Date.now(),
		timer: new SystemTimer(),
		active: async () => {
			// As with probes, open other projects only to recover an existing schedule.
			if (recoveringClocks) {
				recoveringClocks = false;
				if (
					(await signalHome.book.clocks()).some((clock) => clock.next !== null)
				) {
					await everywhere.openAll();
				}
			}
			const names = new Set<string>();
			for (const conversation of await allConversations(false)) {
				for (const wait of conversation.state.signals) {
					if (conversation.signalSubscriptions(wait.name) > 0) {
						names.add(wait.name);
					}
				}
			}
			for (const settled of await Promise.allSettled(served.values())) {
				if (settled.status === "fulfilled") {
					for (const automation of await settled.value
						.signalAutomationList()
						.catch(() => [])) {
						if (!automation.paused) {
							names.add(automation.signal);
						}
					}
				}
			}
			return [...names];
		},
		raise: async (name, by, payload) => {
			await raiseIn(signalHome, name, by, payload);
		},
		error: (error) => log.error(`clock: ${String(error)}`),
	});
	clocks.arm();
	disposer.defer(async () => clocks.dispose());
	expiration = new SignalExpiration({
		book: signalHome.book,
		now: () => Date.now(),
		timer: new SystemTimer(),
		remove: async (name) => {
			const probe = await signalHome.book.probe(name);
			if (probe !== null && isOn(probe)) {
				await probes.stop(name);
			}
			for (const conversation of await allConversations()) {
				conversation.removeSignal(name, "signal expired");
			}
			for (const settled of await Promise.allSettled(served.values())) {
				if (settled.status === "fulfilled") {
					await settled.value.expireSignal(name);
				}
			}
		},
		error: (error) => log.error(`expiring signals: ${String(error)}`),
	});
	disposer.defer(async () => expiration?.dispose());
	void expiration.arm().catch((error: unknown) => log.error(String(error)));
	const signals = new SignalRoutes({
		clocks,
		...signalHome,
		signalFunctions: async () => {
			const found: Record<string, SignalFunction> = {};
			for (const settled of await Promise.allSettled(served.values())) {
				if (settled.status === "fulfilled") {
					Object.assign(found, settled.value.signalFunctions());
				}
			}
			return found;
		},
		rootOfProject: async (slug) =>
			(await projects.list()).find((each) => each.slug === slug)?.root ?? null,
		shell: (script, cwd, timeoutMs) =>
			ps.spawnCapture(["sh", "-c", script], { cwd, timeoutMs }),
		automations: async () => {
			const slugs = new Map(
				(await projects.list()).map((each) => [each.root, each.slug]),
			);
			const found = [];
			for (const settled of await Promise.allSettled(served.values())) {
				if (settled.status !== "fulfilled") {
					continue;
				}
				const project = slugs.get(settled.value.root) ?? "";
				for (const each of await settled.value
					.signalAutomationList()
					.catch(() => [])) {
					found.push({ ...each, project });
				}
			}
			return found;
		},
		retireFamilies: async (known) => {
			for (const settled of await Promise.allSettled(served.values())) {
				if (settled.status === "fulfilled") {
					await settled.value.retireFamilies(known);
				}
			}
		},
		find: async (id) =>
			(await (
				await findConversation(id)
			)?.conversations
				?.find(id)
				.catch(() => null)) ?? null,
		rootOf: async (id) => {
			const owner = await findConversation(id);
			return owner === null || !("root" in owner) ? null : owner.root;
		},
		probes,
		now: () => Date.now(),
		opened: () => allConversations(false),
	});
	// Quota as the agents report it, raised as quota.low, quota.unused and quota.restored.
	const quota = QuotaSignals.start({
		limits: async () => ({
			agents: await limits.all(),
			peaks: await limits.history(),
		}),
		lastUserMessages: async () => lastUserMessagesOf(await allConversations()),
		raise: async (name, payload) => {
			await signals.announce(name, "splates", payload);
		},
		doc: machineStorage.document("quota-signals.json"),
		log,
	});
	disposer.defer(async () => quota.dispose());
	void signals
		.reconcileSignalFunctions()
		.catch((error: unknown) => log.error(String(error)));
	// Hides signals nothing has listened to for a day: at start, then hourly.
	const sweepTimer = new SystemTimer();
	let sweeping: { dispose(): void } | undefined;
	let sweepStopped = false;
	const sweepSignals = () => {
		void signals
			.sweep()
			.catch((error: unknown) => log.error(`signal cleanup: ${String(error)}`))
			.finally(() => {
				if (!sweepStopped) {
					sweeping = sweepTimer.setTimeout(sweepSignals, Duration.mins(60));
				}
			});
	};
	sweepSignals();
	disposer.defer(async () => {
		sweepStopped = true;
		sweeping?.dispose();
	});
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
				fetch: deps.fetch,
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

	const autopickRules = new AutopickRulesRoutes({ fs, home: splatesHome(ps) });
	const autopickHealth = new HealthRoutes({ fs, home: splatesHome(ps) });
	const d2 = new D2Renderer();
	disposer.defer(async () => d2.dispose());
	const diagrams = new DiagramRoutes(d2);

	disposer.defer(() => workers.disposeAsync());
	const taskPorts = new DevTaskPorts({
		worker: () => workers.local,
		owners: () => portOwnersOf(served),
		rigs: () => rigProxyTargetsOf(served),
		base: portsHost,
		access: portsAccess === null ? gate.access : new Access(portsAccess),
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
					"/api/focus": { PUT: guarded(picker.focus) },
					"/api/d2": { POST: guarded(diagrams.render) },
					"/api/stats": guarded(ended.stats),
					"/api/trust/enabled": { PUT: guarded(trust.setEnabled) },
					"/api/trust": {
						GET: guarded(trust.list),
						PUT: guarded(trust.update),
					},
					"/api/trust/conversation": {
						GET: guarded(trust.conversation),
					},
					"/api/trust/scopes": {
						POST: guarded(trust.changeScope),
						DELETE: guarded(trust.changeScope),
					},
					"/api/trust/decisions": {
						GET: guarded(trust.decisions),
						POST: guarded(trust.record),
						PUT: guarded(trust.setEffects),
					},
					"/api/trust/assumptions": { GET: guarded(trust.assumptions) },
					"/api/trust/assumptions/wrong": {
						POST: guarded(trust.markWrong),
					},
					"/api/trust/suggestions": { GET: guarded(trust.suggestions) },
					"/api/auto-pick/scorecard": { GET: guarded(ended.scorecard) },
					"/api/auto-pick/overrides": guarded(ended.overrides),
					"/api/auto-pick/overrides/dismiss": {
						POST: guarded(ended.dismissOverrides),
					},
					"/api/auto-pick/overrides/send": {
						POST: guarded(async (request) => {
							if (request.headers.get("sec-fetch-site") !== "same-origin") {
								return Response.json(
									{
										reason: "usage",
										message:
											"Only the user sends the overrides to an agent, from the Autopick page",
									},
									{ status: 403 },
								);
							}
							const text = await ended.rulesTask();
							if (text === null) {
								return Response.json(
									{
										reason: "usage",
										message:
											"No Autopick cell is flagged with enough tasks to change the rules",
									},
									{ status: 400 },
								);
							}
							const project = await projectFor(request);
							const task = await project.sendToAgent(
								"Propose Autopick rule changes from the scorecard",
								text,
							);
							return Response.json({ task });
						}),
					},
					"/api/auto-pick/improvements": { GET: guarded(ended.improvements) },
					"/api/auto-pick/improvements/dismiss": {
						POST: guarded(ended.dismissImprovements),
					},
					"/api/auto-pick/improvements/send": {
						POST: guarded(async (request) => {
							if (request.headers.get("sec-fetch-site") !== "same-origin") {
								return Response.json(
									{
										reason: "usage",
										message:
											"Only the user sends Autopick's possible improvements to an agent, from the Autopick page",
									},
									{ status: 403 },
								);
							}
							const improvements = await ended.improvementsTask();
							if (improvements === null) {
								return Response.json(
									{
										reason: "usage",
										message: "There are no possible improvements to send",
									},
									{ status: 400 },
								);
							}
							const project = await projectFor(request);
							const task = await project.sendToAgent(
								"Review Autopick's possible improvements",
								improvements.text,
							);
							await ended.improvementsSent(improvements.key);
							return Response.json({ task });
						}),
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
					"/api/billing/unused-quota": guarded(billing.unusedQuota),
					"/api/billing/plan": {
						PUT: guarded(billing.setPlan),
						DELETE: guarded(billing.clearPlan),
					},
					"/api/machine": guarded(async () =>
						Response.json({
							...(await machine.read()),
							queue: queueListing(workers.placement.scheduler.queue()),
						}),
					),
					// Through a tunnel only once Access verified who is asking, as a
					// conversation is: what an agent said goes to the device.
					// Opening rec starts Chrome on this machine, so only as far as a
					// conversation reaches.
					"/api/rec": guarded(rec.read),
					"/api/rec/name": guarded(rec.name),
					"/api/rec/open": { POST: talk(guarded(rec.start)) },
					"/api/rec/close": { POST: talk(guarded(rec.stop)) },
					// A recording can show anything on the person's screen, so these
					// get the same guard as the rest; changes go as far as a conversation.
					"/api/rec/sessions": guarded(rec.list),
					"/api/rec/sessions/search": guarded(rec.search),
					"/api/rec/sessions/:name": {
						GET: guarded(rec.detail),
						DELETE: talk(guarded(rec.remove)),
					},
					"/api/rec/sessions/:name/video": guarded(rec.video),
					"/api/rec/sessions/:name/:kind/:file": guarded(rec.file),
					"/api/rec/sessions/:name/rename": {
						POST: talk(guarded(rec.rename)),
					},
					"/api/rec/sessions/:name/open-folder": {
						POST: talk(guarded(rec.openFolder)),
					},
					"/api/push": talk(guarded(pushes.key)),
					"/api/push/subscription": {
						PUT: talk(guarded(pushes.subscribe)),
						DELETE: talk(guarded(pushes.unsubscribe)),
					},
					"/api/setup": guarded(setup.read),
					"/api/setup/seen": { PUT: guarded(setup.see) },
					"/api/setup/:step/next": { POST: guarded(setup.next) },
					"/api/setup/:area/undo": {
						GET: guarded(setup.undoPlan),
						POST: guarded(setup.undo),
					},
					"/api/auto-pick/rules": {
						GET: guarded(autopickRules.read),
						PUT: guarded(autopickRules.save),
					},
					"/api/auto-pick/avoided": guarded(autopickHealth.read),
					"/api/auto-pick/avoided/clear": {
						POST: guarded(autopickHealth.clear),
					},
					"/api/auto-pick/rules/reset": {
						POST: guarded(autopickRules.reset),
					},
					// It may ask the judge, on the person's key, as a start would.
					"/api/auto-pick/try": {
						POST: talk(scoped((project) => project.tryAutopick)),
					},
					"/api/migration": guarded(migrations.read),
					"/api/migration/retry": { POST: guarded(migrations.retry) },
					"/api/restart": { POST: talk(guarded(restartIdle)) },
					"/api/power": { POST: talk(guarded(powerNow)) },
					"/api/checkpoint": { POST: talk(guarded(checkpointProjects)) },
					"/api/projects/:slug": { DELETE: guarded(forgetProject) },
					"/api/snapshot": conversationScoped((project) => project.snapshot),
					// Conversations among them, so only as far as a conversation reaches.
					"/api/everywhere": talk(guarded(everywhere.list)),
					"/api/everywhere/events": talk(guarded(everywhere.events)),
					"/api/file": conversationScoped((project) => project.file),
					// Limited to what a conversation reaches, since it runs the person's editor.
					"/api/open": { POST: talk(scoped((project) => project.open)) },
					"/api/paths": scoped((project) => project.paths),
					"/api/tasks/:task/diff": scoped((project) => project.diff),
					"/api/tasks/:task/questions": scoped((project) => project.questions),
					"/api/commits/:sha/diff": scoped((project) => project.commitDiff),
					"/api/tasks/:task/merge-output/:index": scoped(
						(project) => project.mergeOutput,
					),
					"/api/rigs": { GET: scoped((project) => project.rigs) },
					"/api/rigs/start": { POST: scoped((project) => project.rigStart) },
					"/api/rigs/stop": { POST: scoped((project) => project.rigStop) },
					"/api/rigs/log": { GET: scoped((project) => project.rigLog) },
					"/api/rigs/presets": {
						PUT: scoped((project) => project.rigPresets),
						DELETE: scoped((project) => project.rigPresets),
					},
					"/api/agent-settings": {
						GET: scoped((project) => project.readAgentSettings),
						PUT: scoped((project) => project.saveAgentSettings),
					},
					"/api/quota-reserve": {
						GET: scoped((project) => project.quotaReserveHolds),
					},
					"/api/queue/agent-authorize": {
						POST: scoped((project) => project.authorizeAgentQueue),
					},
					"/api/queue/chain-spend": {
						GET: scoped((project) => project.chainSpends),
					},
					"/api/queue/agent-chain": {
						GET: scoped((project) => project.readChain),
					},
					"/api/queue/agent-budget": {
						POST: scoped((project) => project.changeChainBudget),
					},
					"/api/ship/targets": {
						GET: scoped((project) => project.shipTargets),
					},
					"/api/ship/unshipped": {
						GET: scoped((project) => project.shipUnshipped),
					},
					"/api/ship/current": {
						GET: scoped((project) => project.shipCurrent),
					},
					"/api/ship/versions": {
						GET: scoped((project) => project.shipVersions),
					},
					"/api/ship/plan": { POST: scoped((project) => project.shipPlan) },
					"/api/ship/runs": {
						GET: scoped((project) => project.shipRuns),
						POST: scoped((project) => project.shipRuns),
					},
					"/api/ship/runs/:id": {
						GET: scoped((project) => project.shipRun),
					},
					"/api/ship/runs/:id/events": {
						GET: scoped((project) => project.shipRunEvents),
					},
					"/api/ship/waiting": {
						GET: scoped((project) => project.shipWaiting),
					},
					"/api/ship/runs/:id/answer": {
						POST: scoped((project) => project.shipRunAnswer),
					},
					"/api/ship/runs/:id/retry": {
						POST: scoped((project) => project.shipRunRetry),
					},
					"/api/ship/runs/:id/stop": {
						POST: scoped((project) => project.shipRunStop),
					},
					"/api/ship/runs/:id/targets/:target/stop": {
						POST: scoped((project) => project.shipRunTargetStop),
					},
					"/api/ship/runs/:id/send": {
						POST: scoped((project) => project.shipRunSend),
					},
					"/api/ship/runs/:id/send-target": {
						POST: scoped((project) => project.shipRunSendTarget),
					},
					"/api/ship/runs/:id/supervise": {
						POST: scoped((project) => project.shipRunSupervise),
					},
					"/api/ship/runs/:id/auto-approve": {
						POST: scoped((project) => project.shipRunAutoApprove),
					},
					"/api/ship/runs/:id/note": {
						POST: scoped((project) => project.shipRunNote),
					},
					"/api/ship/runs/:id/fix-retry": {
						POST: scoped((project) => project.shipRunFixRetry),
					},
					"/api/finished": scoped((project) => project.finishedTasks),
					"/api/merge-estimates": scoped((project) => project.mergeEstimates),
					"/api/quarantined": scoped((project) => project.quarantined),
					"/api/finished/:key": scoped((project) => project.finishedTask),
					"/api/tasks/:task/outcome": scoped((project) =>
						ended.landed(project.root),
					),
					// Runs on this machine, in the asking command's worktree and environment.
					"/api/merges": {
						POST: local(scoped((project) => project.startMerge)),
					},
					"/api/merges/:task": {
						GET: local(scoped((project) => project.readMerge)),
						DELETE: local(scoped((project) => project.doneMerge)),
					},
					"/api/tasks/:task/bump": {
						POST: scoped((project) => project.bumpMerge),
					},
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
					"/api/todos/:id/queue-position": {
						PUT: scoped((project) => project.moveInQueue),
					},
					"/api/todos/:id/retry": {
						POST: scoped((project) => project.retryQueued),
					},
					"/api/lanes": { POST: scoped((project) => project.addLane) },
					"/api/boards": { POST: scoped((project) => project.addBoard) },
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
					"/api/boards/:id": {
						PUT: scoped((project) => project.updateBoard),
						DELETE: scoped((project) => project.dropBoard),
					},
					"/events": conversationScoped((project) => project.events),
					"/api/conversations": {
						GET: talk(
							conversationScoped((project) => project.listConversations),
						),
						POST: talk(
							conversationScoped((project) => project.startConversation),
						),
					},
					"/api/conversations/search": {
						GET: talk(
							conversationScoped((project) => project.searchConversations),
						),
					},
					"/api/conversations/auto": {
						POST: talk(conversationScoped((project) => project.startAutopick)),
					},
					"/api/conversations/sessions": {
						GET: talk(conversationScoped((project) => project.listSessions)),
						POST: talk(conversationScoped((project) => project.bringSession)),
					},
					"/api/conversations/defaults": {
						PUT: talk(conversationScoped((project) => project.chooseDefault)),
					},
					"/api/conversations/limits": {
						POST: talk(conversationScoped((project) => project.refreshLimits)),
					},
					"/api/conversations/events": talk(
						conversationScoped((project) => project.conversationEvents),
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
					"/api/signals": { GET: talk(signals.list) },
					"/api/signals/raise": { POST: talk(signals.raise) },
					"/api/signals/expiration": { POST: talk(signals.expiration) },
					"/api/signals/cleanup": { POST: talk(signals.cleanup) },
					"/api/signals/revive": { POST: talk(signals.revive) },
					// A page the system killed says so, for an agent to look into once
					// it has repeated.
					"/api/page-kills": {
						POST: guarded(pageKillRoute(signalHome, body)),
					},
					"/api/conversations/:id/signal-wait": { POST: talk(signals.wait) },
					"/api/conversations/:id/signal-probe": { POST: talk(signals.probe) },
					"/api/signals/probe-stop": { POST: talk(signals.stopProbe) },
					"/api/signals/poll-now": { POST: talk(signals.pollNow) },
					"/api/signals/check": { POST: talk(signals.check) },
					"/api/signals/check-test": { POST: talk(signals.testCheck) },
					"/api/conversations/:id/signal-wait/:wait/stop": {
						POST: talk(signals.stop),
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
					"/api/conversations/:id/cancel-eval": {
						POST: talk(owned((project) => project.cancelEval)),
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
						PUT: talk(owned((project) => project.switchAutopick)),
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
					"/api/conversations/:id/visit": {
						PUT: talk(owned((project) => project.visitConversation)),
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
					"/api/conversations/:id/continue": {
						POST: talk(
							guarded(
								general?.continueConversation ??
									(() => fail("not_found", "no General conversations", {})),
							),
						),
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
				if (pathname === "/api/terminals") {
					return terminals.list(request);
				}
				if (pathname === "/api/terminals/events") {
					return terminals.events(request);
				}
				if (pathname === "/api/terminals/name" && request.method === "PUT") {
					return terminals.rename(request);
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
	// General's live agents take their processes back before the worker joins too.
	await general?.conversations.list();
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
		await general?.disposeAsync();
	});
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
