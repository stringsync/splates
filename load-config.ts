import { basename, resolve } from "node:path";
import { type Fs, NodeFs } from "@webappwiz/system";
import type { Config } from "./config";

export interface LoadConfigOptions {
	/** What `arbor.config.ts` is looked for through; the real one by default. */
	fs?: Fs;
}

export async function loadConfig(
	root: string,
	opts: LoadConfigOptions = {},
): Promise<Config> {
	return { ...defaults(root), ...(await file(opts.fs ?? new NodeFs(), root)) };
}

function defaults(root: string): Config {
	return {
		trunk: "main",
		worktreeRoot: resolve(root, "..", `${basename(root)}-arbor`),
		postCheckout: null,
		postRewrite: null,
		preMerge: null,
		leaseStalenessMs: 90_000,
		mergeRetryCount: 2,
		removedCapacity: 50,
		logCapacity: 200,
	};
}

async function file(fs: Fs, root: string): Promise<Partial<Config>> {
	const path = `${root}/arbor.config.ts`;
	if (!(await fs.exists(path))) {
		return {};
	}
	const mod = (await import(path)) as { default?: Partial<Config> };
	return mod.default ?? {};
}
