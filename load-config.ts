import { basename, resolve } from "node:path";
import { type Fs, NodeFs } from "webappwiz/system";
import { z } from "zod";
import type { Config, System } from "./config";
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
	const found = await readConfig(root, opts.fs);
	// Only a repo that has not said which branch is its trunk pays for the
	// detecting spawn.
	const trunk =
		found.trunk ??
		(await (opts.git ?? new Git(root)).defaultBranch()) ??
		"main";
	return { ...defaults(root, trunk), ...found };
}

function defaults(root: string, trunk: string): Config {
	return {
		trunk,
		worktreeRoot: resolve(root, "..", `${basename(root)}-arbor`),
		postCheckout: null,
		postRewrite: null,
		preMerge: null,
		leaseStalenessMs: 90_000,
		mergeRetryCount: 3,
		removedCapacity: 50,
		logCapacity: 1000,
		todoStalenessMs: 30 * 24 * 60 * 60 * 1000,
		attachmentCapacity: 100 * 1024 * 1024,
		systems: {},
	};
}

/**
 * What `root`'s `arbor.config.ts` names, checked, or nothing when there is no
 * such file. Read afresh whenever the file has changed, so a long-running
 * `arbor dev` sees a system named mid-task without a restart.
 */
export async function readConfig(
	root: string,
	fs: Fs = new NodeFs(),
): Promise<Partial<Config>> {
	const path = `${root}/arbor.config.ts`;
	if (!(await fs.exists(path))) {
		return {};
	}
	// `import()` keeps a module for as long as the process runs, keyed by what
	// it was asked for, so asking by the file's contents re-imports it only
	// once it has changed.
	const version = Bun.hash(await fs.read(path)).toString(36);
	// Falling back to the defaults would be worse than failing: a config arbor
	// silently ignored is a `preMerge` gate that silently stopped running.
	const mod = (await import(`${path}?v=${version}`).catch((cause: unknown) => {
		throw new Error(
			`could not load ${path}: ${cause}. Its imports may be stale: try \`bun install\` in ${root}.`,
			{ cause },
		);
	})) as { default?: Partial<Config> };
	const config = mod.default ?? {};
	if (config.systems !== undefined) {
		checkSystems(path, config.systems);
	}
	return config;
}

const SYSTEMS = z.record(
	z.string().min(1),
	z.strictObject({
		aliases: z.array(z.string().min(1)).optional(),
		globs: z.array(z.string().min(1)).min(1),
		ignore: z.array(z.string().min(1)).optional(),
	}),
);

/**
 * Refuses systems that are not in the shape `System` names, or two that
 * answer to the same name, which would leave `arbor systems <name>` guessing.
 */
function checkSystems(path: string, systems: unknown): void {
	const parsed = SYSTEMS.safeParse(systems);
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		throw new Error(
			`${path}: systems.${issue?.path.join(".")}: ${issue?.message}`,
		);
	}
	const owners = new Map<string, string>();
	for (const [name, system] of Object.entries(parsed.data) as [
		string,
		System,
	][]) {
		for (const called of [name, ...(system.aliases ?? [])]) {
			const owner = owners.get(called);
			if (owner !== undefined) {
				throw new Error(
					`${path}: systems '${owner}' and '${name}' both answer to '${called}': give each its own names`,
				);
			}
			owners.set(called, name);
		}
	}
}
