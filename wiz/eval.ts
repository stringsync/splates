import { NodePs, type Ps } from "webappwiz/system";
import { ROOT } from "./root";

export interface EvalOptions {
	/** What arbor's evals entry is given: fast selection, report, or explicit e2e, then its arguments. */
	args: string[];
	ps?: Ps;
}

/** Run the focused suite by default; legacy end-to-end evaluation requires `e2e`. */
export async function evalSkill(opts: EvalOptions): Promise<void> {
	const ps = opts.ps ?? new NodePs();
	const args = opts.args.length ? opts.args : ["fast"];
	const { exitCode } = await ps.spawn(
		["bun", "evals/arbor-skill/index.ts", ...args],
		{ cwd: ROOT },
	);
	if (exitCode !== 0) {
		throw new Error("The evals failed");
	}
}
