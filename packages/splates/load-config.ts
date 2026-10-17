import { realpath } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { type Fs, NodeFs } from "webappwiz/system";
import { ARTIFACT_LIMITS } from "./artifacts";
import type { Config } from "./config";
import { Git } from "./git";
import { legacyFile, legacyWarnings } from "./legacy-names";

/** The file a repo's settings are in, at its root. */
export const CONFIG_FILE = "splates.config.ts";

export interface LoadConfigOptions {
	/** What `splates.config.ts` is looked for through; the real one by default. */
	fs?: Fs;
	/** What the trunk is detected through; the repo's own git by default. */
	git?: Git;
}

/**
 * The settings splates runs a repo with: what `splates.config.ts` names, then the
 * branch `origin/HEAD` points at for the trunk, then splates's own defaults.
 * Throws when the config file is there but cannot be imported.
 */
export async function loadConfig(
	root: string,
	opts: LoadConfigOptions = {},
): Promise<Config> {
	const found = await new ConfigFiles(opts.fs).read(root);
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
		remote: null,
		// Spotlight skips a folder named `*.noindex`, and only that: indexing
		// every `bun install` and removal in the worktrees kept two cores busy
		// and made timing tests fail the merge gate. A file marking the folder,
		// `.metadata_never_index`, is ignored by macOS 26.
		worktreeRoot: resolve(root, "..", `${basename(root)}-splates.noindex`),
		postCheckout: null,
		postRewrite: null,
		preMerge: null,
		leaseStalenessMs: 90_000,
		agentsPerAgent: 15,
		mergeRetryCount: 3,
		removedCapacity: 50,
		logCapacity: 1000,
		todoStalenessMs: 30 * 24 * 60 * 60 * 1000,
		attachmentCapacity: 100 * 1024 * 1024,
		artifactFileCapacity: ARTIFACT_LIMITS.file,
		artifactConversationCapacity: ARTIFACT_LIMITS.conversation,
		artifactProjectCapacity: ARTIFACT_LIMITS.project,
		wiz: "bunx @webappwiz/cli",
		tunnel: null,
	};
}

/** Reads the TypeScript files a repo keeps its settings in, through `fs`. */
export class ConfigFiles {
	constructor(private readonly fs: Fs = new NodeFs()) {}

	/**
	 * What `root`'s `splates.config.ts` names, or nothing when there is no such
	 * file. Systems live in `splates.systems.ts` now: a config that still names
	 * them is read without them, so `splates update` can run to move them.
	 */
	async read(root: string): Promise<Partial<Config>> {
		const { systems: _, ...config } = await this.importConfig(root);
		return config as Partial<Config>;
	}

	/**
	 * Everything `root`'s `splates.config.ts` exports as its default, unchecked, or
	 * nothing when there is no such file.
	 */
	importConfig(root: string): Promise<Record<string, unknown>> {
		return this.importDefault(root, CONFIG_FILE);
	}

	/**
	 * Where `file` is at `root`, under arbor's old name for it until `splates
	 * update` renames it, or null when it is under neither.
	 */
	private async found(root: string, file: string): Promise<string | null> {
		const path = `${root}/${file}`;
		if (await this.fs.exists(path)) {
			return path;
		}
		const old = legacyFile(file);
		if (old === null || !(await this.fs.exists(`${root}/${old}`))) {
			return null;
		}
		legacyWarnings.once(old, `${file}: run \`splates update\``);
		return `${root}/${old}`;
	}

	/**
	 * What the TypeScript file `file` at `root` exports as its default, unchecked,
	 * or nothing when there is no such file. Read afresh whenever the file has
	 * changed, so a long-running `splates server` sees an edit without a restart.
	 */
	async importDefault(
		root: string,
		file: string,
	): Promise<Record<string, unknown>> {
		const path = await this.found(root, file);
		if (path === null) {
			return {};
		}
		// `import()` keeps a module for as long as the process runs, keyed by what
		// it was asked for, so asking by the file's contents re-imports it only
		// once it has changed.
		const version = Bun.hash(await this.fs.read(path)).toString(36);
		// Asked through a symlinked directory, such as macOS's `/var`, Bun's
		// resolver misses a file made after it first listed the directory. Not on
		// disk, as a fake `fs` has it, the path stays as it is.
		const real = await realpath(path).catch(() => path);
		// Falling back to the defaults would be worse than failing: a config splates
		// silently ignored is a `preMerge` gate that silently stopped running.
		const mod = (await import(`${real}?v=${version}`).catch(
			(cause: unknown) => {
				throw new Error(
					`could not load ${path}: ${cause}. Its imports may be stale: try \`bun install\` in ${root}.`,
					{ cause },
				);
			},
		)) as { default?: Record<string, unknown> };
		return mod.default ?? {};
	}
}
