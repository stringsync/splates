import type * as acp from "@agentclientprotocol/sdk";
import type { Fs, ListeningEntry, ProcessEntry, Ps } from "webappwiz/system";
import type { SessionServers } from "../agents";
import { type GitResult, type GitRunner, processGit } from "../git";
import { splatesHome } from "../models";
import { type ProjectCheckout, WorkerCheckouts } from "./checkouts";

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
	/**
	 * The MCP servers it offers each agent session it runs, beyond the
	 * agent's own, such as its shared browser, which runs there too, so a
	 * session reaches it on its own loopback; none from a worker that offers
	 * none.
	 */
	servers(): Promise<acp.McpServer[]>;
}

/** The machine this process runs on, as a worker answers for it. */
export class LocalWorkerMachine implements WorkerMachine {
	readonly git: WorkerMachine["git"];
	private readonly checkouts: WorkerCheckouts;

	constructor(
		private readonly ps: Ps,
		private readonly fs: Fs,
		/** What it offers sessions; none by default. */
		private readonly offered: SessionServers | null = null,
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

	async servers(): Promise<acp.McpServer[]> {
		return (await this.offered?.servers()) ?? [];
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
 * Whether `path`, where a worker on `host` would clone each task, is on a
 * Windows drive WSL mounts at `/mnt/<letter>`, rather than its own disk.
 */
export function onWindowsDrive(host: string | null, path: string): boolean {
	return host === "wsl2" && /^\/mnt\/[a-z](\/|$)/i.test(path);
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
