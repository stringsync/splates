import { dirname } from "node:path";
import { MemoryLock } from "webappwiz/system";
import { SystemTimer } from "webappwiz/time";
import { Adherence } from "./adherence";
import type { ArborDeps } from "./arbor";
import { rosterOf, savedTunnelOf, seeded } from "./arbor-flags";
import { codexLimits, isCodex } from "./codex-limits";
import { Conversations } from "./conversations";
import { type DevServer, dev, devPorts } from "./dev";
import { accessConfig } from "./dev-access";
import { rebuildOnChange } from "./dev-pages";
import { devServers } from "./dev-servers";
import { devSlot } from "./dev-slot";
import { savedTunnelConfig, tunnelConfig } from "./dev-tunnel";
import { DevWorkers, LOCAL_WORKER } from "./dev-workers";
import { fail } from "./exit";
import { Git } from "./git";
import { HeavyJobs } from "./heavy";
import { Limits } from "./limits";
import { loadConfig } from "./load-config";
import { Offered } from "./offered";
import { Outcomes } from "./outcomes";
import { Projects } from "./projects";
import { newest, sourceCommit } from "./release";
import { arborHome } from "./roster";
import { SharedBrowser } from "./shared-browser";
import { SERVER_PID, SLOT, slotOf } from "./slots";
import { SERVING, supervise, UNBUILT } from "./supervise";
import type { TunnelProvider } from "./tunnel-provider";
import { Watch } from "./watch";
import { WorkerGit } from "./worker-git";
import { workerSocketPath } from "./worker-run";

/**
 * What `arbor dev` does with its flags: run itself as a supervised child, so
 * the page can restart it, which then serves the page, reached through the
 * tunnel and Access the flags name, or else the ones saved for this machine.
 * It serves every registered project wherever it is started; the page picks
 * which one it shows. The server, from the child; nothing from the
 * supervisor, which exits.
 */
export async function serveDev(
	ctx: ArborDeps,
	opts: DevFlags,
): Promise<DevServer | undefined> {
	// Read before the child starts, so a half-given pair fails once.
	let access = accessConfig(opts["access-team"], opts["access-aud"]);
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
		// `arbor dev` serves the machine's tunnel, from the slot's home.
		const slot = opts.slot ? await devSlot(ctx) : null;
		// Agents run on the local worker, beside the server, so a restart
		// leaves them running.
		const worker = ["worker", "run", "--id", LOCAL_WORKER, "--quiet"];
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
	// A slot's server says which process it is, so the next start of the slot
	// can tell one left running by a killed wrapper.
	if (ctx.ps.env(SLOT) !== undefined) {
		await ctx.fs.write(
			`${arborHome(ctx.ps)}/${SERVER_PID}`,
			String(ctx.ps.pid),
		);
	}
	// Read once: a roster edited while it serves applies from the restart.
	const roster = await seeded(rosterOf(ctx));
	// One for every project's conversations, so none overwrites another's.
	const offered = new Offered(`${arborHome(ctx.ps)}/offered.json`, {
		fs: ctx.fs,
	});
	const limits = new Limits(`${arborHome(ctx.ps)}/limits.json`, {
		fs: ctx.fs,
	});
	// Judged as each turn ends, for the Stats page, across projects like the
	// outcomes it reads the merged commits from.
	const adherence = new Adherence(
		`${arborHome(ctx.ps)}/adherence.jsonl`,
		ctx.fs,
		new Outcomes(`${arborHome(ctx.ps)}/outcomes.jsonl`, ctx.fs),
	);
	// One for every project, so agents resumed together start one at a time.
	const starting = new MemoryLock();
	const projects = Projects.ofMachine(ctx);
	// One for every project, so every agent on the machine shares one browser.
	const browser = new SharedBrowser(
		{
			ps: ctx.ps,
			fs: ctx.fs,
			timer: new SystemTimer(),
			log: ctx.log,
			heavy: HeavyJobs.ofMachine(ctx),
		},
		arborHome(ctx.ps),
	);
	// Agents run on this machine's worker, which the supervisor starts beside
	// this server; what they are sent waits for it to join.
	const workers = new DevWorkers(ctx.log);
	const worker = workers.local;
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
			conversations: ({ arborDir, git }) =>
				new Conversations(`${arborDir}/conversations`, roster, {
					fs: ctx.fs,
					launch: worker.launch,
					machine: worker,
					starting,
					offered,
					limits,
					adherence,
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
					watch: new Watch(new WorkerGit(git.root, worker)),
					root: git.root,
					projects,
					servers: browser,
				}),
			// A login shell, as a terminal window opens, so the person's PATH
			// and aliases are there.
			shell: [ctx.ps.env("SHELL") ?? "/bin/sh", "-l"],
			newest: () => newest(),
			source: () => sourceCommit(ctx.ps),
			unbuilt: ctx.ps.env(UNBUILT) !== undefined,
			// From a checkout, the page is built again as `dev/` changes.
			rebuilds:
				(await sourceCommit(ctx.ps)) === null
					? null
					: (pages) => rebuildOnChange(pages, ctx, import.meta.dirname),
			slot: slotOf(ctx.ps.env(SLOT) ?? ""),
			servers: () => devServers(ctx),
			exit: (code) => ctx.ps.exit(code),
			workerSocket: workerSocketPath(ctx.ps),
			workers,
			worker,
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
 * The tunnel provider `arbor.config.ts` names in the repository `arbor dev`
 * was started in, if it was started in one: the one thing it reads from where
 * it runs. Null outside a repository, or for one naming none.
 */
async function tunnelProvider({
	fs,
	ps,
}: ArborDeps): Promise<TunnelProvider | null> {
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

/** The flags `arbor dev` takes, as `serveDev` reads them. */
export interface DevFlags {
	port: number;
	"allow-hosts": string;
	"access-team": string;
	"access-aud": string;
	tunnel: string;
	"tunnel-name": string;
	slot: boolean;
}
