import type { Fs, ProcessEntry, Ps } from "webappwiz/system";
import { Git, type GitResult } from "./git";

/** A file's size, and its bytes from where the caller last read up to. */
export interface WorkerRead {
	size: number;
	bytes: Uint8Array;
}

/**
 * What the coordinator asks of the machine a task runs on: git in its
 * worktree around each tool call (`Watch`), a background command's output
 * (`ConversationBackground`), and the process table (`heldBy`).
 */
export interface WorkerMachine {
	git(cwd: string, args: string[]): Promise<GitResult>;
	processes(): Promise<ProcessEntry[]>;
	/** `path` from byte `from` on; a missing file reads as empty. */
	read(path: string, from: number): Promise<WorkerRead>;
	/** Whether anything is at `path`, a file or a directory. */
	exists(path: string): Promise<boolean>;
}

/** The machine this process runs on, as a worker answers for it. */
export class LocalWorkerMachine implements WorkerMachine {
	private readonly runner: Git;

	constructor(
		private readonly ps: Ps,
		private readonly fs: Fs,
	) {
		// `run` takes its own cwd, so the root is never read.
		this.runner = new Git("/", { ps, fs });
	}

	git(cwd: string, args: string[]): Promise<GitResult> {
		return this.runner.run(cwd, ...args);
	}

	processes(): Promise<ProcessEntry[]> {
		return this.ps.processes();
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
