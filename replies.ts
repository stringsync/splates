import { type IdProvider, UuidProvider } from "webappwiz/id";
import type { Fs, Lock } from "webappwiz/system";
import { Attachments } from "./attachments";

/**
 * Where the files a person attaches to an answer live, at
 * `.git/arbor/replies/<task>/<question>/`, out of the tree so they are never
 * committed. Removing a task takes its folder with it. The answer itself goes
 * straight into the task's `ARBOR.md`.
 */
export class Replies {
	private readonly ids: IdProvider;

	constructor(
		readonly dir: string,
		/** Held across reading a plan and writing an answer into it, so two answers never cross. */
		private readonly lock: Lock,
		private readonly fs: Fs,
		{ ids = new UuidProvider() }: { ids?: IdProvider } = {},
	) {
		this.ids = ids;
	}

	/** Runs `work` holding the lock every answer is written under. */
	async locked<T>(work: () => Promise<T>): Promise<T> {
		await this.lock.acquire();
		try {
			return await work();
		} finally {
			await this.lock.release();
		}
	}

	attachments(task: string, question: string): Attachments {
		return new Attachments(
			`${this.dir}/${task}/${question}`,
			this.fs,
			this.ids,
		);
	}

	/** Whether `path` is a file some answer holds, and not a way out of here. */
	owns(path: string): boolean {
		return new Attachments(this.dir, this.fs).owns(path);
	}
}
