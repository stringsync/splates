import { homedir } from "node:os";
import { dirname } from "node:path";
import { SystemTimer } from "webappwiz/time";
import { SharedBrowser, StartLock, Watch } from "../agents";
import { artifactLimits } from "../artifacts";
import {
	type Config,
	LEGACY_DIR,
	loadConfig,
	moveLegacyDir,
	unmigrated,
} from "../config";
import { Conversations } from "../conversations";
import { SYSTEM_STORES } from "../creds";
import { fail } from "../exit";
import { Git } from "../git";
import { pushOnMove, TaskBranches } from "../merge";
import { codexLimits, isCodex, Limits, Offered, splatesHome } from "../models";
import { PlanStore } from "../plans";
import { devSlot, SERVER_PID, SLOT, slotOf } from "../ports";
import { Projects } from "../projects";
import { Adherence, Outcomes } from "../stats";
import { FsStorage } from "../storage";
import {
	API_TOKEN,
	accessConfig,
	portsHostFlag,
	savedTunnelConfig,
	tunnelConfig,
} from "../tunnel";
import {
	CloudflareWorkerAccess,
	CoordinatorState,
	DevWorkers,
	LOCAL_WORKER,
	Snapshots,
	WORKER_KEYS_FILE,
	WorkerBudget,
	WorkerKeys,
	WorkerPlacement,
	WorkerRecords,
	workerGit,
	workerSocketPath,
} from "../workers";
import { heavyJobsOfMachine } from "./heavy";
import { newest, RUNNING, sourceCommit } from "./release";
import type { SplatesDeps } from "./runtime-deps";
import { type DevServer, dev, devPorts } from "./server";
import { devServers } from "./servers";
import {
	rosterOf,
	savedPortsHostOf,
	savedTunnelOf,
	seeded,
} from "./start-settings";
import { awakeCommand, SERVING, supervise, UNBUILT } from "./supervise";

/**
 * Runs `splates server` with its flags: the page for every registered
 * project, wherever it is started, reached through the tunnel and Access
 * the flags name, or else the ones saved for this machine. Answers the
 * server in the child it runs as, and nothing in the supervisor, which exits.
 */
export async function serveDev(
	ctx: SplatesDeps,
	opts: DevFlags,
): Promise<DevServer | undefined> {
	// It runs itself as a supervised child, so the page can restart it.
	// Read before the child starts, so a half-given pair fails once.
	let access = accessConfig(opts["access-team"], opts["access-aud"]);
	const portsFlag = portsHostFlag(opts["ports-host"]);
	const here = await startedIn(ctx);
	let tunnel = tunnelConfig(
		opts.tunnel,
		opts["tunnel-name"],
		access,
		here?.tunnel ?? null,
		ctx.ps,
	);
	if (
		opts.slot &&
		[
			opts.tunnel,
			opts["tunnel-name"],
			opts["access-team"],
			opts["access-aud"],
		].some((flag) => flag.trim() !== "")
	) {
		fail(
			"usage",
			"--slot runs a tunnel of its own: leave off the tunnel and Access flags",
			{},
		);
	}
	if (opts.keepalive && awakeCommand(ctx.ps.platform, ctx.ps.pid) === null) {
		fail(
			"usage",
			"--keepalive keeps macOS and Linux awake: this platform has nothing to do it",
			{},
		);
	}
	// Served from a child, so the page can restart it.
	if (ctx.ps.env(SERVING) === undefined) {
		// Before the worker or a slot reads the home, once for the machine.
		if (ctx.ps.env("SPLATES_HOME") === undefined) {
			const home = ctx.ps.env("HOME") ?? homedir();
			await moveLegacyDir(`${home}/.${LEGACY_DIR}`, `${home}/.splates`, ctx);
		}
		// A checkout's page is as its last `bun install` built it: installed
		// again before each start, whose postinstall builds the page, a
		// restart onto new source serves its page, even one whose commits
		// added a package.
		const checkout = (await sourceCommit(ctx.ps)) !== null;
		const [runtime = "bun"] = ctx.ps.self;
		const build = checkout
			? { argv: [runtime, "install"], cwd: dirname(import.meta.dirname) }
			: null;
		// The slot is readied here, once, and its child serves it as a bare
		// `splates server` serves the machine's tunnel, from the slot's home.
		const slot = opts.slot ? await devSlot(ctx) : null;
		if (portsFlag !== undefined) {
			await savedPortsHostOf(ctx).save(portsFlag);
		}
		// Agents run on the local worker, beside the server, so a restart
		// leaves them running.
		const worker = [
			"worker",
			"run",
			"--id",
			LOCAL_WORKER,
			"--slots",
			String(opts["worker-slots"]),
			"--quiet",
		];
		ctx.ps.exit(
			await supervise(ctx.ps, {
				build,
				env: slot?.env,
				worker,
				checkout: build === null ? null : { path: build.cwd, fs: ctx.fs },
				awake: opts.keepalive,
				log: ctx.log,
			}),
		);
		return;
	}
	// The saved tunnel only when no flag says how to reach the page, so a
	// flag never mixes with what was saved.
	const flagged = [
		opts.tunnel,
		opts["tunnel-name"],
		opts["access-team"],
		opts["access-aud"],
	].some((flag) => flag.trim() !== "");
	if (!flagged) {
		const saved = await savedTunnelConfig(savedTunnelOf(ctx), ctx.ps, ctx.log);
		access = saved?.access ?? null;
		tunnel = saved?.tunnel ?? null;
	}
	const portsHost =
		portsFlag === undefined ? await savedPortsHostOf(ctx).read() : portsFlag;
	// A slot's server says which process it is, so the next start of the slot
	// can tell one left running by a killed wrapper.
	if (ctx.ps.env(SLOT) !== undefined) {
		await ctx.fs.write(
			`${splatesHome(ctx.ps)}/${SERVER_PID}`,
			String(ctx.ps.pid),
		);
	}
	// One for every project's conversations, so none overwrites another's.
	const settingsStorage = FsStorage.ofMachine(ctx);
	const offered = new Offered(settingsStorage.document("offered.json"));
	// Read once: a roster edited while it serves applies from the restart.
	const roster = await seeded(rosterOf(ctx), offered);
	const limits = new Limits(settingsStorage.document("limits.json"));
	// Judged as each turn ends, for the Stats page, across projects like the
	// outcomes it reads the merged commits from.
	const machine = FsStorage.ofMachine(ctx);
	const outcomes = new Outcomes(machine);
	const adherence = new Adherence(machine, outcomes, ctx.fs);
	// One for every project, and every other splates process here, so agents
	// resumed together start one at a time.
	const starting = StartLock.ofMachine(ctx);
	const projects = Projects.ofMachine(ctx);
	// Tasks that ended before Codex and OpenCode were priced get their cost now.
	void outcomes
		.backfill((project, conversation) =>
			new FsStorage(
				unmigrated(`${project}/.git/splates`, `${project}/.git/${LEGACY_DIR}`),
				ctx.fs,
			).log(`conversations/${conversation}.jsonl`),
		)
		.catch((error: unknown) => {
			ctx.log.error(`the price backfill failed: ${String(error)}`);
		});
	// One for every project, so every agent on the machine shares one browser.
	const browser = new SharedBrowser(
		{
			ps: ctx.ps,
			fs: ctx.fs,
			timer: new SystemTimer(),
			log: ctx.log,
			heavy: heavyJobsOfMachine(ctx),
		},
		splatesHome(ctx.ps),
	);
	// Agents run on this machine's worker, which the supervisor starts beside
	// this server; what they are sent waits for it to join. The worker knows
	// this server by a session that outlives its restarts, so it keeps them
	// running through one.
	const coordinator = await CoordinatorState.open(
		settingsStorage.document("coordinator.json"),
	);
	// The workers that joined, kept so a restart lets each back in.
	const records = await WorkerRecords.open(
		settingsStorage.document("workers.json"),
	);
	// Through a tunnel, each worker passes Access with a service token of its
	// own, minted with the API token `splates tunnel setup` keeps.
	const device = (ctx.secrets ?? SYSTEM_STORES).device;
	// Each worker's API keys, in the device's store, since workers serve
	// every project.
	const keys = await WorkerKeys.open(
		settingsStorage.document(WORKER_KEYS_FILE),
		device,
	);
	// Made workers dial the page where the tunnel publishes it.
	const provider = here?.workerProvider ?? null;
	const reached = tunnel === null ? null : `https://${tunnel.host}`;
	const workers = new DevWorkers(ctx.log, {
		session: coordinator.session,
		protocol: coordinator.protocol,
		platform: ctx.ps.platform,
		records,
		access:
			tunnel === null
				? null
				: new CloudflareWorkerAccess({
						host: tunnel.host,
						apiToken: () => device.get(API_TOKEN),
						log: ctx.log,
					}),
		keys,
		...(provider === null || here === null
			? {}
			: {
					provider: {
						provider,
						snapshots: await Snapshots.open(provider, {
							version: RUNNING,
							document: settingsStorage.document("snapshots.json"),
						}),
						coordinator: () => reached,
						budget: await WorkerBudget.open(
							settingsStorage.document("worker-budget.json"),
						),
					},
				}),
	});
	void workers.provisioning?.reconcile().catch((error: unknown) => {
		ctx.log.error(
			`the worker provider could not list its machines: ${String(error)}`,
		);
	});
	const worker = workers.local;
	const { slots } = workers;
	const server = await dev(
		{ ...ctx, projects },
		{
			ports: devPorts(opts.port),
			hosts: opts["allow-hosts"]
				.split(",")
				.map((host) => host.trim())
				.filter(Boolean),
			access,
			tunnel,
			portsHost,
			conversations: ({ splatesDir, storage, git, config, creds, service }) => {
				const branches = TaskBranches.of({
					git,
					config,
					creds,
					plans: new PlanStore(ctx.fs, storage),
				});
				return new Conversations(`${splatesDir}/conversations`, roster, {
					fs: ctx.fs,
					artifacts: artifactLimits(config),
					launcher: worker,
					slots: slots.project(git.root, config.platform),
					machine: worker,
					checkouts: new WorkerPlacement({
						service,
						branches,
						config,
						slug: async () =>
							(await projects.list()).find((each) => each.root === git.root)
								?.slug ?? null,
					}),
					starting,
					offered,
					limits,
					adherence,
					outcomes,
					readLimits: async (agent) =>
						isCodex(agent)
							? codexLimits({
									launch: worker.launch,
									timer: new SystemTimer(),
									now: () => Date.now(),
									cwd: git.root,
									codex: ctx.ps.env("CODEX_PATH"),
								})
							: [],
					watch: new Watch(
						workerGit(git.root, worker),
						pushOnMove(branches, ctx.log),
					),
					root: git.root,
					projects,
					servers: browser,
				});
			},
			// A login shell, as a terminal window opens, so the person's PATH
			// and aliases are there.
			shell: [ctx.ps.env("SHELL") ?? "/bin/sh", "-l"],
			newest: () => newest(),
			source: () => sourceCommit(ctx.ps),
			unbuilt: ctx.ps.env(UNBUILT) !== undefined,
			slot: slotOf(ctx.ps.env(SLOT) ?? ""),
			servers: () => devServers(ctx),
			exit: (code) => ctx.ps.exit(code),
			workerSocket: workerSocketPath(ctx.ps),
			workers,
			worker,
			coordinator,
		},
	);
	return {
		port: server.port,
		disposeAsync: async () => {
			await server.disposeAsync();
			await browser.disposeAsync();
		},
	};
}

/**
 * The config of the repository `splates server` was started in, if it was
 * started in one, for the providers it names: the one thing it reads from
 * where it runs. Null outside a repository.
 */
async function startedIn({ fs, ps }: SplatesDeps): Promise<Config | null> {
	const { exitCode, stdout } = await ps.spawnCapture(
		["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
		{ cwd: ps.cwd() },
	);
	if (exitCode !== 0) {
		return null;
	}
	const root = dirname(stdout.trim());
	return loadConfig(root, { fs, git: new Git(root, { ps, fs }) });
}

/** The flags `splates server` takes, as `serveDev` reads them. */
export interface DevFlags {
	port: number;
	"allow-hosts": string;
	"access-team": string;
	"access-aud": string;
	tunnel: string;
	"tunnel-name": string;
	"ports-host": string;
	"worker-slots": number;
	keepalive: boolean;
	slot: boolean;
}
