import { SystemTimer } from "webappwiz/time";
import { Adherence } from "./adherence";
import type { ArborDeps } from "./arbor";
import { rosterOf, savedTunnelOf, seeded } from "./arbor-flags";
import { codexLimits, isCodex } from "./codex-limits";
import { Conversations, launch } from "./conversations";
import { type DevServer, dev, devPorts } from "./dev";
import { accessConfig } from "./dev-access";
import { devSlot, SLOT } from "./dev-slot";
import { savedTunnelConfig, tunnelConfig } from "./dev-tunnel";
import { fail } from "./exit";
import { Limits } from "./limits";
import { Offered } from "./offered";
import { Outcomes } from "./outcomes";
import { newest, sourceCommit } from "./release";
import type { Repository } from "./repository";
import { arborHome } from "./roster";
import { slotOf } from "./slots";
import { SERVING, supervise, UNBUILT } from "./supervise";
import { Watch } from "./watch";

/**
 * What `arbor dev` does with its flags: run itself as a supervised child, so
 * the page can restart it, which then serves the page, reached through the
 * tunnel and Access the flags name, or else the ones saved for this machine.
 * The server, from the child; nothing from the supervisor, which exits.
 */
export async function serveDev(
	ctx: ArborDeps & Repository,
	opts: DevFlags,
): Promise<DevServer | undefined> {
	// Read before the child starts, so a half-given pair fails once.
	let access = accessConfig(opts["access-team"], opts["access-aud"]);
	let tunnel = tunnelConfig(
		opts.tunnel,
		opts["tunnel-name"],
		access,
		ctx.config.tunnel,
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
		ctx.ps.exit(
			await supervise(ctx.ps, {
				build,
				env: slot?.env,
				cwd: slot?.cwd,
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
	return dev(ctx, {
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
				offered,
				limits,
				adherence,
				readLimits: async (agent) =>
					isCodex(agent)
						? codexLimits({
								launch,
								timer: new SystemTimer(),
								now: () => Date.now(),
								cwd: git.root,
								codex: ctx.ps.env("CODEX_PATH"),
							})
						: [],
				watch: new Watch(git),
				root: git.root,
			}),
		// A login shell, as a terminal window opens, so the person's PATH
		// and aliases are there.
		shell: [ctx.ps.env("SHELL") ?? "/bin/sh", "-l"],
		newest: () => newest(),
		source: () => sourceCommit(ctx.ps),
		unbuilt: ctx.ps.env(UNBUILT) !== undefined,
		slot: slotOf(ctx.ps.env(SLOT) ?? ""),
		exit: (code) => ctx.ps.exit(code),
	});
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
