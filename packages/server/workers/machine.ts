import type { Fs, ListeningEntry, ProcessEntry, Ps } from "webappwiz/system";
import { type GitResult, type GitRunner, processGit } from "../git";

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

/** The memory one agent's slot counts on: a session, its tools and a share of a test run. */
const SLOT_MEMORY = 4 * 1024 ** 3;

/**
 * The slots a worker takes by default on a machine of `cores` and `memory`
 * bytes: one for each core and `SLOT_MEMORY`, whichever is fewer, so 6 on
 * a 6-core WSL2 given 26 GB.
 */
export function machineSlots(cores: number, memory: number): number {
	return Math.max(1, Math.min(cores, Math.floor(memory / SLOT_MEMORY)));
}
