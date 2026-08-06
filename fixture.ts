import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryLogger } from "@webappwiz/log";
import { NodeFs, NodePs } from "@webappwiz/sys";
import { type Config, type Ctx, load } from "./context";

/** A real NodePs that records `exit` and signals instead of acting on them. */
export class TestPs extends NodePs {
	readonly exits: number[] = [];
	private readonly handlers = new Map<
		string,
		Array<(...a: unknown[]) => void>
	>();
	private readonly dead = new Set<number>();

	override exit(code: number): void {
		this.exits.push(code);
	}

	override on(signal: string, handler: (...a: unknown[]) => void): void {
		this.handlers.set(signal, [...(this.handlers.get(signal) ?? []), handler]);
	}

	override once(event: "exit", handler: () => void): void {
		this.on(event, handler);
	}

	dispatch(signal: string): void {
		for (const handler of this.handlers.get(signal) ?? []) {
			handler();
		}
	}

	override alive(pid: number): boolean {
		return this.dead.has(pid) ? false : super.alive(pid);
	}

	markDead(pid: number): void {
		this.dead.add(pid);
	}

	lastExit(): number | undefined {
		return this.exits.at(-1);
	}
}

export interface Fixture {
	ctx: Ctx;
	ps: TestPs;
	log: MemoryLogger;
	root: string;
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

/** A throwaway git repo with one commit on `main`, plus an arbor context. */
export async function fixture(config: Partial<Config> = {}): Promise<Fixture> {
	const base = await realpath(await mkdtemp(join(tmpdir(), "arbor-")));
	const root = join(base, "repo");
	const ps = new TestPs();
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
		ctx: await load(fs, ps, log, root),
		ps,
		log,
		root,
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
