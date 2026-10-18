import type { Logger } from "webappwiz/log";
import {
	FileLock,
	type Fs,
	type Lock,
	MemoryLock,
	type Ps,
} from "webappwiz/system";
import { splatesHome } from "../roster";

/**
 * Take it while an agent starts, so agents start one at a time across every
 * splates process on this machine.
 */
export class StartLock implements Lock {
	// They share `bunx`'s install of the agent, which one starting relinks
	// under another. One process's starts queue in memory, so only the one at the front
	// waits on the file, which logs each wait.
	private readonly queue = new MemoryLock();
	private readonly file: FileLock;

	constructor(path: string, deps: { fs: Fs; ps: Ps; log: Logger }) {
		this.file = new FileLock(path, deps);
	}

	/** This machine's, in `SPLATES_HOME`, `~/.splates` for none. */
	static ofMachine(deps: { fs: Fs; ps: Ps; log: Logger }): StartLock {
		return new StartLock(`${splatesHome(deps.ps)}/starting.lock`, deps);
	}

	async acquire(): Promise<void> {
		await this.queue.acquire();
		try {
			await this.file.acquire();
		} catch (error) {
			await this.queue.release();
			throw error;
		}
	}

	// scry-ignore resources-are-disposable: `Lock` names it release, as every lock splates takes does.
	async release(): Promise<void> {
		try {
			await this.file.release();
		} finally {
			await this.queue.release();
		}
	}

	async releaseIfOurs(): Promise<void> {
		await this.file.releaseIfOurs();
	}
}
