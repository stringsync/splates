import { join } from "node:path";
import { ConsoleLogger, type Logger } from "webappwiz/log";
import { NodePs, type Ps } from "webappwiz/system";
import { ROOT } from "./root";

/** The proofs, each a script in `docker/`. */
export const PROOFS = ["coordinator"] as const;
export type Proof = (typeof PROOFS)[number];

export interface ProveOptions {
	proof: Proof;
	/** What the script takes after its name, such as a port or `--agent`. */
	args?: string[];
	ps?: Ps;
	log?: Logger;
}

/**
 * Runs a proof of splates on Linux end to end: `coordinator` runs the server
 * in a Docker container with this machine as its worker. It prints what it
 * checked and fails on the first thing wrong.
 */
export async function prove(opts: ProveOptions): Promise<void> {
	const ps = opts.ps ?? new NodePs();
	const log = opts.log ?? new ConsoleLogger();
	log.info(`proving the ${opts.proof} on Linux; needs Docker`);
	const { exitCode } = await ps.spawn(
		[
			"sh",
			join(ROOT, "docker", `prove-${opts.proof}.sh`),
			...(opts.args ?? []),
		],
		{ cwd: ROOT },
	);
	if (exitCode !== 0) {
		throw new Error(`The ${opts.proof} proof failed`);
	}
}
