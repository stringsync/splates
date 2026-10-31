import { NodePs, type Ps } from "core/system";
import { ROOT } from "./root";

export interface EvalOptions {
	/** What splates's evals entry is given: `list`, `plan`, `run` or `report`, then its arguments. */
	args: string[];
	ps?: Ps;
}

/** Runs the skill's eval scenarios (`packages/evals/skill`); with no arguments, its help. */
export async function evalSkill(opts: EvalOptions): Promise<void> {
	const ps = opts.ps ?? new NodePs();
	const { exitCode } = await ps.spawn(
		["bun", "packages/evals/skill/index.ts", ...opts.args],
		{ cwd: ROOT },
	);
	if (exitCode !== 0) {
		throw new Error("The evals failed");
	}
}
