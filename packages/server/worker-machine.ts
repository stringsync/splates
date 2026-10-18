import type { Fs, ListeningEntry, ProcessEntry, Ps } from "webappwiz/system";
import { type GitResult, type GitRunner, processGit } from "./git";
import { splatesHome } from "./roster";
import { type ProjectCheckout, WorkerCheckouts } from "./worker-checkouts";

/** A file's size, and its bytes from where the caller last read up to. */
export interface WorkerRead {
	size: number;
	bytes: Uint8Array;
}

/**
 * What the coordinator asks of the machine a task runs on: git in its
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
	/**
	 * Fetches, or makes, the project's mirror and its clone of trunk, and
	 * answers where the clone is (`WorkerCheckouts.checkout`).
	 */
	checkout(request: ProjectCheckout): Promise<string>;
	/** Takes away a task's clone made beside a project's (`WorkerCheckouts.remove`). */
	removeCheckout(path: string): Promise<void>;
}

/** The machine this process runs on, as a worker answers for it. */
export class LocalWorkerMachine implements WorkerMachine {
	readonly git: WorkerMachine["git"];
	private readonly checkouts: WorkerCheckouts;

	constructor(
		private readonly ps: Ps,
		private readonly fs: Fs,
	) {
		this.git = processGit(ps).git;
		this.checkouts = new WorkerCheckouts(splatesHome(ps), ps, fs);
	}

	checkout(request: ProjectCheckout): Promise<string> {
		return this.checkouts.checkout(request);
	}

	removeCheckout(path: string): Promise<void> {
		return this.checkouts.remove(path);
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
