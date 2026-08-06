import { basename, resolve } from "node:path";
import type { Fs } from "@webappwiz/sys";

export interface Config {
	/** What `graft` runs after rebasing, via `sh -c`. */
	testCommand: string;
	trunk: string;
	worktreeRoot: string;
	portRange: [number, number];
	/** Command run by `create` in the new worktree, via `sh -c`. */
	postCreate: string | null;
	leaseStalenessMs: number;
	graftRetryBudget: number;
}

/** Defaults for this repo, overridden by whatever `arbor.config.ts` sets. */
export async function loadConfig(fs: Fs, root: string): Promise<Config> {
	return { ...(await defaults(fs, root)), ...(await file(fs, root)) };
}

async function defaults(fs: Fs, root: string): Promise<Config> {
	return {
		testCommand: (await hasTestScript(fs, root)) ? "bun run test" : "bun test",
		trunk: "main",
		worktreeRoot: resolve(root, "..", `${basename(root)}-arbor`),
		portRange: [3100, 3199],
		postCreate: null,
		leaseStalenessMs: 90_000,
		graftRetryBudget: 2,
	};
}

async function hasTestScript(fs: Fs, root: string): Promise<boolean> {
	const raw = await fs.read(`${root}/package.json`).catch(() => "{}");
	try {
		return typeof JSON.parse(raw)?.scripts?.test === "string";
	} catch {
		return false;
	}
}

async function file(fs: Fs, root: string): Promise<Partial<Config>> {
	const path = `${root}/arbor.config.ts`;
	if (!(await fs.exists(path))) {
		return {};
	}
	const mod = (await import(path)) as { default?: Partial<Config> };
	return mod.default ?? {};
}
