import { ConsoleLogger, color, type Logger } from "webappwiz/log";
import { NodePs, type Ps } from "webappwiz/system";
import type { PhaseTimer } from "./phases";
import { AgentPriority } from "./priority";
import { ROOT } from "./root";

export interface FixOptions {
	/** Report problems without writing fixes, as CI wants it. */
	check: boolean;
	/** Check only code rules, without credentials or model calls. */
	codeOnly?: boolean;
	/** Skip Scry when checking a release that was already reviewed. */
	skipScry?: boolean;
	log?: Logger;
	ps?: Ps;
	/** What puts an agent's run behind a merge gate; this run's own by default. */
	priority?: AgentPriority;
	/** What times each check for a merge's gate; untimed when left out. */
	phases?: PhaseTimer;
}

/**
 * Runs biome, the type checker, then scry on what changed since main, in
 * that order. Scry leaves off each model its budget no longer covers, so a
 * spent budget narrows the check rather than fail it.
 */
export async function fix(opts: FixOptions): Promise<void> {
	const log = opts.log ?? new ConsoleLogger();
	const ps = opts.ps ?? new NodePs();

	// Every step says how it went and the first failure ends the run, so the
	// verdict a person reads last is the one that stopped them.
	const step = (name: string, ok: boolean, failure: string): void => {
		log.info(`${name}: ${ok ? color.green("success") : color.red("failed")}`);
		if (!ok) {
			throw new Error(failure);
		}
	};

	// An agent's run beside a merge gate makes way for it; biome, tsc and scry inherit the nice.
	(opts.priority ?? new AgentPriority(ps)).lower();
	const timed = <T>(phase: string, run: () => Promise<T>): Promise<T> =>
		opts.phases ? opts.phases.time(phase, run) : run();
	const flags = opts.check ? [] : ["--write", "--unsafe"];
	const biome = await timed("biome", () =>
		ps.spawn(["bunx", "biome", "check", ...flags, "."], { cwd: ROOT }),
	);
	step("biome", biome.exitCode === 0, "Biome check failed");

	const typecheck = await timed("typecheck", () =>
		ps.spawn(["bunx", "tsc", "--noEmit"], { cwd: ROOT }),
	);
	step("typecheck", typecheck.exitCode === 0, "Typechecking failed");

	if (opts.skipScry) {
		return;
	}

	const scry = await timed("scry", () =>
		ps.spawn(
			[
				"bunx",
				"@webappwiz/cli",
				"scry",
				"check",
				"--since",
				"main",
				"--disable-over-budget",
				...(opts.codeOnly ? ["--disable", "som", "--disable", "llm"] : []),
			],
			{ cwd: ROOT },
		),
	);
	step("scry", scry.exitCode === 0, "Scry check failed");
}
