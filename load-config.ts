import { basename, resolve } from "node:path";
import { type Fs, NodeFs } from "webappwiz/system";
import { CONFIG_FACTORY, type Config, type ConfigRecord } from "./config";
import { Git } from "./git";

export interface LoadConfigOptions {
	/** What `arbor.config.ts` is looked for through; the real one by default. */
	fs?: Fs;
	/** What the trunk is detected through; the repo's own git by default. */
	git?: Git;
}

/**
 * The settings arbor runs a repo with: what `arbor.config.ts` names, then the
 * branch `origin/HEAD` points at for the trunk, then arbor's own defaults.
 * Throws when the config file is there but cannot be imported.
 */
export async function loadConfig(
	root: string,
	opts: LoadConfigOptions = {},
): Promise<Config> {
	const found = await file(opts.fs ?? new NodeFs(), root);
	// Only a repo that has not said which branch is its trunk pays for the
	// detecting spawn.
	const trunk =
		found.trunk ??
		(await (opts.git ?? new Git(root)).defaultBranch()) ??
		"main";
	return CONFIG_FACTORY.create({ ...defaults(root, trunk), ...found });
}

function defaults(root: string, trunk: string): ConfigRecord {
	return {
		trunk,
		worktreeRoot: resolve(root, "..", `${basename(root)}-arbor`),
		postCheckout: null,
		postRewrite: null,
		preMerge: null,
		postMerge: null,
		leaseStalenessMs: 90_000,
		mergeRetryCount: 2,
		removedCapacity: 50,
		logCapacity: 200,
	};
}

async function file(fs: Fs, root: string): Promise<Partial<ConfigRecord>> {
	const path = `${root}/arbor.config.ts`;
	if (!(await fs.exists(path))) {
		return {};
	}
	// Falling back to the defaults would be worse than failing: a config arbor
	// silently ignored is a `preMerge` gate that silently stopped running.
	const mod = (await import(path).catch((cause: unknown) => {
		throw new Error(
			`could not load ${path}: ${cause}. Its imports may be stale: try \`bun install\` in ${root}.`,
			{ cause },
		);
	})) as { default?: Partial<ConfigRecord> };
	return mod.default ?? {};
}
