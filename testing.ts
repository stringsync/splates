import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BunHttpServer } from "@webappwiz/http";
import { color, MemoryLogger } from "@webappwiz/log";
import { NodeFs, NodePs } from "@webappwiz/system";
import { FakeProcess } from "@webappwiz/system/testing";
import type { Config } from "./config";
import { assets } from "./dev/assets";
import { Exit } from "./exit";

/** pid 1 always exists, so it stands in for another agent that is still running. */
export const LIVE_PID = 1;

/**
 * Runs a command that is expected to bail, and hands back how it bailed:
 * reason, message and data all ride on the `Exit` itself.
 */
export async function bails(work: Promise<unknown>): Promise<Exit> {
	try {
		await work;
	} catch (entry) {
		if (entry instanceof Exit) {
			return entry;
		}
		throw entry;
	}
	throw new Error("expected a nonzero exit, but the command succeeded");
}

/** Arbitrary but valid settings, for tests that do not care about config. */
export function testConfig(
	root: string,
	overrides: Partial<Config> = {},
): Config {
	return {
		trunk: "main",
		worktreeRoot: `${root}-arbor`,
		postCheckout: null,
		postRewrite: null,
		// Keeps merge's gate green unless a test asks otherwise.
		preMerge: "true",
		leaseStalenessMs: 90_000,
		removedCapacity: 50,
		mergeRetryCount: 2,
		logCapacity: 200,
		...overrides,
	};
}

/**
 * A throwaway git repo with one commit on `main`. Deliberately knows nothing
 * about arbor: each test file wires the collaborators it is exercising.
 */
export async function repo() {
	const base = await realpath(await mkdtemp(join(tmpdir(), "arbor-")));
	const root = join(base, "repo");
	// Spawns for real; its exits and signals are the fake process's to keep.
	const proc = new FakeProcess();
	const ps = new NodePs({ proc });
	const log = new MemoryLogger();
	const fs = new NodeFs();

	// Named apart from the `Git` collaborator, which tests wire themselves.
	const gitCli = async (cwd: string, ...args: string[]): Promise<string> => {
		const { exitCode, stdout, stderr } = await ps.spawnCapture([
			"git",
			"-C",
			cwd,
			...args,
		]);
		if (exitCode !== 0) {
			throw new Error(`git ${args.join(" ")}: ${stderr}`);
		}
		return stdout.trim();
	};

	const commit = async (
		cwd: string,
		file: string,
		content: string,
		message: string,
	): Promise<void> => {
		await fs.write(join(cwd, file), content);
		await gitCli(cwd, "add", file);
		await gitCli(cwd, "commit", "-m", message);
	};

	await fs.mkdir(root);
	await gitCli(root, "init", "-b", "main");
	await gitCli(root, "config", "user.email", "arbor@example.com");
	await gitCli(root, "config", "user.name", "arbor");
	await gitCli(root, "config", "commit.gpgsign", "false");
	await commit(root, "README.md", "seed\n", "seed");

	const cleanup = () => rm(base, { recursive: true, force: true });

	return {
		root,
		arborDir: join(root, ".git", "arbor"),
		fs,
		ps,
		// the exits `ps` records rather than takes
		proc,
		log,
		// the real ones: `dev` is tested by serving a page and fetching it, so a
		// stand-in would only have to grow into these. The assets are the ones
		// that publish, which is the point of asserting on what comes back.
		http: new BunHttpServer(),
		assets,
		gitCli,
		commit,
		out: () =>
			color.strip(log.entries.map((entry) => String(entry.message)).join("\n")),
		cleanup,
		// so a concurrent test can own its repo with `await using`, instead of
		// afterEach handing every test in the file the same one
		[Symbol.asyncDispose]: async () => void (await cleanup()),
	};
}
