import { homedir } from "node:os";
import { dirname } from "node:path";
import { SystemTimer } from "webappwiz/time";
import { Adherence } from "./adherence";
import { artifactLimits } from "./artifacts";
import { codexLimits, isCodex } from "./codex-limits";
import { Conversations } from "./conversations";
import { CoordinatorState } from "./coordinator-state";
import { type DevServer, dev, devPorts } from "./dev";
import { accessConfig } from "./dev-access";
import { devServers } from "./dev-servers";
import { devSlot } from "./dev-slot";
import { savedTunnelConfig, tunnelConfig } from "./dev-tunnel";
import { DevWorkers, LOCAL_WORKER } from "./dev-workers";
import { fail } from "./exit";
import { Git } from "./git";
import { heavyJobsOfMachine } from "./heavy";
import { LEGACY_DIR, moveLegacyDir } from "./legacy-names";
import { Limits } from "./limits";
import { loadConfig } from "./load-config";
import { Offered } from "./offered";
import { Outcomes } from "./outcomes";
import { PlanStore } from "./plan-store";
import { Projects } from "./projects";
import { newest, sourceCommit } from "./release";
import { splatesHome } from "./roster";
import { portsHostFlag } from "./saved-ports-host";
import { SharedBrowser } from "./shared-browser";
import { SERVER_PID, SLOT, slotOf } from "./slots";
import type { SplatesDeps } from "./splates";
import {
	rosterOf,
	savedPortsHostOf,
	savedTunnelOf,
	seeded,
} from "./splates-flags";
import { StartLock } from "./start-lock";
import { SERVING, supervise, UNBUILT } from "./supervise";
import { pushOnMove, TaskBranches } from "./task-branches";
import type { TunnelProvider } from "./tunnel-provider";
import { Watch } from "./watch";
import { workerGit } from "./worker-git";
import { WorkerPlacement } from "./worker-placement";
import { WorkerRecords } from "./worker-records";
import { workerSocketPath } from "./worker-run";

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
	let tunnel = tunnelConfig(
		opts.tunnel,
		opts["tunnel-name"],
		access,
		await tunnelProvider(ctx),
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
			? { argv: [runtime, "install"], cwd: import.meta.dirname }
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
		ctx.ps.exit(await supervise(ctx.ps, { build, env: slot?.env, worker }));
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
	// Read once: a roster edited while it serves applies from the restart.
	const roster = await seeded(rosterOf(ctx));
	// One for every project's conversations, so none overwrites another's.
	const offered = new Offered(`${splatesHome(ctx.ps)}/offered.json`, {
		fs: ctx.fs,
	});
	const limits = new Limits(`${splatesHome(ctx.ps)}/limits.json`, {
		fs: ctx.fs,
	});
	// Judged as each turn ends, for the Stats page, across projects like the
	// outcomes it reads the merged commits from.
	const outcomes = new Outcomes(
		`${splatesHome(ctx.ps)}/outcomes.jsonl`,
		ctx.fs,
	);
	const adherence = new Adherence(
		`${splatesHome(ctx.ps)}/adherence.jsonl`,
		ctx.fs,
		outcomes,
	);
	// One for every project, and every other splates process here, so agents
	// resumed together start one at a time.
	const starting = StartLock.ofMachine(ctx);
	const projects = Projects.ofMachine(ctx);
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
		`${splatesHome(ctx.ps)}/coordinator.json`,
		ctx.fs,
	);
	// The workers that joined, kept so a restart lets each back in.
	const records = await WorkerRecords.open(
		`${splatesHome(ctx.ps)}/workers.json`,
		ctx.fs,
	);
	const workers = new DevWorkers(ctx.log, {
		session: coordinator.session,
		protocol: coordinator.protocol,
		platform: ctx.ps.platform,
		records,
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
			conversations: ({ splatesDir, git, config, creds, service }) => {
				const branches = TaskBranches.of({
					git,
					config,
					creds,
					plans: new PlanStore(ctx.fs, splatesDir),
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
 * The tunnel provider `splates.config.ts` names in the repository `splates server`
 * was started in, if it was started in one: the one thing it reads from where
 * it runs. Null outside a repository, or for one naming none.
 */
async function tunnelProvider({
	fs,
	ps,
}: SplatesDeps): Promise<TunnelProvider | null> {
	const { exitCode, stdout } = await ps.spawnCapture(
		["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
		{ cwd: ps.cwd() },
	);
	if (exitCode !== 0) {
		return null;
	}
	const root = dirname(stdout.trim());
	return (await loadConfig(root, { fs, git: new Git(root, { ps, fs }) }))
		.tunnel;
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
	slot: boolean;
}
