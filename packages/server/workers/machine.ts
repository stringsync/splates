import type { Fs, ListeningEntry, ProcessEntry, Ps } from "core/system";
import { prepareScratch } from "../agents";
import { type GitResult, type GitRunner, processGit } from "../git";
import { descendants } from "./process-host";

/** A file's size, and its bytes from where the caller last read up to. */
export interface WorkerRead {
	size: number;
	bytes: Uint8Array;
}

/**
 * What the server asks of the machine a task runs on: git in its
 * worktree around each tool call (`Watch`), a background command's output
 * (`ConversationBackground`), the process table (`heldBy`), and the ports
 * its processes listen on (`TaskPorts`).
 */
export interface WorkerMachine extends GitRunner {
	/**
	 * `git -C <cwd> <args>`, `env` added to its environment, as `GitRunner`
	 * runs it: untrimmed. A token in `env` is held in memory there, never on
	 * disk.
	 */
	git(
		cwd: string,
		args: string[],
		env?: Record<string, string>,
	): Promise<GitResult>;
	processes(): Promise<ProcessEntry[]>;
	listening(): Promise<ListeningEntry[]>;
	/** `path` from byte `from` on; a missing file reads as empty. */
	read(path: string, from: number): Promise<WorkerRead>;
	/** Whether anything is at `path`, a file or a directory. */
	exists(path: string): Promise<boolean>;
	/** Makes the directories `agent` may write in its scratch workspace at `cwd`. */
	scratch(agent: string, cwd: string): Promise<void>;
	/**
	 * Stops every process whose working directory is `path` or under it,
	 * which a dev server an agent left running, reparented away from it, is.
	 * Pass `exclude` to leave specific pids (such as the agent finishing its
	 * turn) alone.
	 */
	stopUnder(path: string, exclude?: readonly number[]): Promise<void>;
	/**
	 * Stops each pid in `pids` and all of its descendants, skipping this
	 * worker process and any pids listed in `exclude`.
	 */
	stopProcessTree(pids: number[], exclude?: readonly number[]): Promise<void>;
}

/** The machine this process runs on, as a worker answers for it. */
export class LocalWorkerMachine implements WorkerMachine {
	readonly git: WorkerMachine["git"];

	constructor(
		private readonly ps: Ps,
		private readonly fs: Fs,
	) {
		this.git = processGit(ps).git;
	}

	processes(): Promise<ProcessEntry[]> {
		return this.ps.processes();
	}

	listening(): Promise<ListeningEntry[]> {
		return this.ps.listening();
	}

	exists(path: string): Promise<boolean> {
		return this.fs.exists(path);
	}

	scratch(agent: string, cwd: string): Promise<void> {
		return prepareScratch(this.fs, agent, cwd, this.ps.env("HOME"));
	}

	async stopUnder(
		path: string,
		exclude: readonly number[] = [],
	): Promise<void> {
		const found = await this.ps
			.spawnCapture(["lsof", "-a", "-d", "cwd", "-Fpn"])
			.catch(() => null);
		if (found === null) {
			return;
		}
		const skip = new Set<number>([this.ps.pid, ...exclude]);
		const pids = cwdPids(found.stdout, path).filter((pid) => !skip.has(pid));
		if (pids.length > 0) {
			await this.ps
				.spawn(["kill", "-TERM", ...pids.map(String)])
				.catch(() => {});
		}
	}

	async stopProcessTree(
		pids: number[],
		exclude: readonly number[] = [],
	): Promise<void> {
		if (pids.length === 0) {
			return;
		}
		const table = await this.ps.processes().catch(() => []);
		const skip = new Set<number>([this.ps.pid, ...exclude]);
		const targets = new Set<number>();
		for (const pid of pids) {
			if (pid <= 0 || skip.has(pid)) {
				continue;
			}
			targets.add(pid);
			for (const child of descendants(table, pid)) {
				if (child > 0 && !skip.has(child)) {
					targets.add(child);
				}
			}
		}
		if (targets.size > 0) {
			await this.ps
				.spawn(["kill", "-TERM", ...[...targets].map(String)])
				.catch(() => {});
		}
	}

	async read(path: string, from: number): Promise<WorkerRead> {
		if (!(await this.fs.exists(path))) {
			return { size: 0, bytes: new Uint8Array(0) };
		}
		const bytes = await this.fs.readBytes(path);
		return { size: bytes.byteLength, bytes: bytes.slice(from) };
	}
}

/**
 * What the platform runs inside, for the list to show: `wsl2` under
 * Windows' WSL, which sets `WSL_DISTRO_NAME` in every process it starts;
 * null on the bare machine.
 */
export function hostOf(ps: Ps): string | null {
	return ps.env("WSL_DISTRO_NAME") ? "wsl2" : null;
}

/**
 * The pids in `lsof -Fpn` output whose working directory is `path` or under
 * it, matched on whole path segments so a sibling folder with the same prefix
 * is left alone.
 */
export function cwdPids(output: string, path: string): number[] {
	const root = path.replace(/\/+$/, "");
	const pids: number[] = [];
	let pid = 0;
	for (const line of output.split("\n")) {
		if (line.startsWith("p")) {
			pid = Number(line.slice(1));
		} else if (line.startsWith("n") && pid > 0) {
			// Linux appends " (deleted)" once the worktree directory is gone.
			const cwd = line.slice(1).replace(/ \(deleted\)$/, "");
			if (cwd === root || cwd.startsWith(`${root}/`)) {
				pids.push(pid);
			}
		}
	}
	return pids;
}
