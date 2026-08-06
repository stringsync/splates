import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryLogger } from "@webappwiz/log";
import { NodeFs, NodePs } from "@webappwiz/sys";
import { FakeProcess } from "@webappwiz/sys/testing";
import type { Config } from "./config";
import { Exit } from "./exit";
import type { Failure, Failures } from "./failures";

/** pid 1 always exists, so it stands in for another agent that is still running. */
export const LIVE_PID = 1;

/** Runs a command that is expected to bail, and hands back how it bailed. */
export async function bails(work: Promise<unknown>): Promise<Exit> {
	try {
		await work;
	} catch (e) {
		if (e instanceof Exit) {
			return e;
		}
		throw e;
	}
	throw new Error("expected a nonzero exit, but the command succeeded");
}

/**
 * Collects what a `Failures` raises. Commands no longer print their own
 * refusals, so this is where a test reads the message and data from.
 */
export function raised(failures: Failures): Failure[] {
	const seen: Failure[] = [];
	failures.events.on("fail", (f) => seen.push(f));
	return seen;
}

/** Arbitrary but valid settings, for tests that do not care about config. */
export function testConfig(
	root: string,
	overrides: Partial<Config> = {},
): Config {
	return {
		// Keeps graft's test gate green unless a test asks otherwise.
		testCommand: "true",
		trunk: "main",
		worktreeRoot: `${root}-arbor`,
		portRange: [3100, 3199],
		postCreate: null,
		leaseStalenessMs: 90_000,
		rememberedPrunes: 50,
		graftRetryBudget: 2,
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
	const ps = new NodePs(new FakeProcess());
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

	return {
		root,
		arborDir: join(root, ".git", "arbor"),
		fs,
		ps,
		log,
		gitCli,
		commit,
		out: () =>
			Bun.stripANSI(log.entries.map((e) => String(e.message)).join("\n")),
		cleanup: () => rm(base, { recursive: true, force: true }),
	};
}
