import { ConsoleLogger, type Logger } from "webappwiz/log";
import { NodePs, type Ps } from "webappwiz/system";
import { ROOT } from "./root";

export interface InstallOptions {
	log?: Logger;
	ps?: Ps;
}

/**
 * What `postCheckout` runs in a new worktree, which shares no `node_modules`
 * with the repo: the dependencies, installed.
 */
export async function postCheckout(opts: InstallOptions): Promise<void> {
	await install("postcheckout", opts);
}

/**
 * What `postRewrite` runs after a merge's rebase, and in the gate's scratch
 * worktree: the rebase can bring in a dependency the tree never installed,
 * and the gate's tests need it.
 */
export async function postRewrite(opts: InstallOptions): Promise<void> {
	await install("postrewrite", opts);
}

async function install(name: string, opts: InstallOptions): Promise<void> {
	const log = opts.log ?? new ConsoleLogger();
	const ps = opts.ps ?? new NodePs();
	const run = await ps.spawn(["bun", "install"], { cwd: ROOT });
	if (run.exitCode !== 0) {
		throw new Error(`${name}: bun install failed`);
	}
	log.info(`${name}: installed`);
}
