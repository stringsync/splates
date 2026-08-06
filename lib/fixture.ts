import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryLogger } from "@webappwiz/log";
import { type Fs, NodeFs, NodePs, type Ps } from "@webappwiz/sys";
import { FakeProcess } from "@webappwiz/sys/testing";
import { Arbor, type Config } from "./arbor";

export interface Fixture {
	arbor: Arbor;
	fs: Fs;
	/** Spawns for real; its exits and signals are the fake process's to keep. */
	ps: Ps;
	proc: FakeProcess;
	log: MemoryLogger;
	root: string;
	/** Where the graft lock lands, now that `Lock` hides its mechanism. */
	lockPath: string;
	/** Commits a file in the given worktree. */
	commit(
		cwd: string,
		file: string,
		content: string,
		message: string,
	): Promise<void>;
	git(cwd: string, ...args: string[]): Promise<string>;
	out(): string;
	cleanup(): Promise<void>;
}

/** A throwaway git repo with one commit on `main`, plus an arbor wired to it. */
export async function fixture(config: Partial<Config> = {}): Promise<Fixture> {
	const base = await realpath(await mkdtemp(join(tmpdir(), "arbor-")));
	const root = join(base, "repo");
	const proc = new FakeProcess();
	const ps = new NodePs(proc);
	const log = new MemoryLogger();
	const fs = new NodeFs();

	const run = async (cwd: string, ...args: string[]): Promise<string> => {
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

	await fs.mkdir(root);
	await run(root, "init", "-b", "main");
	await run(root, "config", "user.email", "arbor@example.com");
	await run(root, "config", "user.name", "arbor");
	await run(root, "config", "commit.gpgsign", "false");

	const commit = async (
		cwd: string,
		file: string,
		content: string,
		message: string,
	): Promise<void> => {
		await fs.write(join(cwd, file), content);
		await run(cwd, "add", file);
		await run(cwd, "commit", "-m", message);
	};
	await commit(root, "README.md", "seed\n", "seed");

	// `true` keeps graft's test gate green unless a test asks otherwise.
	const merged: Partial<Config> = { testCommand: "true", ...config };
	await fs.write(
		join(root, "arbor.config.ts"),
		`export default ${JSON.stringify(merged, null, "\t")};\n`,
	);

	return {
		arbor: await Arbor.open(fs, ps, log, root),
		fs,
		ps,
		proc,
		log,
		root,
		lockPath: join(root, ".git", "arbor", "graft.lock"),
		commit,
		git: run,
		out: () =>
			Bun.stripANSI(log.entries.map((e) => String(e.message)).join("\n")),
		cleanup: () => rm(base, { recursive: true, force: true }),
	};
}

/** The reason field arbor puts on stdout for a failure. */
export function reason(log: MemoryLogger): string | undefined {
	for (const entry of [...log.entries].reverse()) {
		try {
			const parsed = JSON.parse(String(entry.message)) as { reason?: string };
			if (parsed.reason) {
				return parsed.reason;
			}
		} catch {
			// not the machine-readable line
		}
	}
	return undefined;
}
