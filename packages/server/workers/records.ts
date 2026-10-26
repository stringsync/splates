import { z } from "zod";
import type { Document } from "../storage";

/** Settings for this machine's worker, kept across server restarts. */
const Record = z.object({
	id: z.string(),
	draining: z.boolean().default(false),
	removing: z.boolean().default(false),
	updating: z.boolean().default(false),
});
const Kept = z.object({
	workers: z.array(Record).default([]),
	local: z.boolean().default(true),
	/** Whether everything splates starts on its own waits, the person's own agents alone starting. */
	paused: z.boolean().default(false),
});
type KeptFile = z.output<typeof Kept>;
export type WorkerRecord = z.output<typeof Record>;
export type WorkerSettings = Partial<Omit<WorkerRecord, "id">>;

/** Persists local worker settings, ignoring workers registered by older builds. */
export class WorkerRecords {
	private writing: Promise<void> = Promise.resolve();
	private constructor(
		private readonly document: Document<KeptFile> | null,
		private kept: KeptFile,
	) {}
	static async open(document: Document<KeptFile>): Promise<WorkerRecords> {
		let kept: KeptFile = { workers: [], local: true, paused: false };
		try {
			const read = await document.read();
			if (read !== null) {
				kept = Kept.parse(read);
				kept.workers = kept.workers.filter((each) => each.id === "local");
			}
		} catch {
			/* Unreadable settings use the local defaults. */
		}
		return new WorkerRecords(document, kept);
	}
	static memory(): WorkerRecords {
		return new WorkerRecords(null, {
			workers: [],
			local: true,
			paused: false,
		});
	}
	get all(): WorkerRecord[] {
		return [...this.kept.workers];
	}
	of(id: string): WorkerRecord | undefined {
		return this.kept.workers.find((each) => each.id === id);
	}
	get localOn(): boolean {
		return this.kept.local;
	}
	async turnLocal(on: boolean): Promise<void> {
		await this.change({ ...this.kept, local: on });
	}
	/** Whether everything splates starts on its own waits, as `pause` set. */
	get paused(): boolean {
		return this.kept.paused;
	}
	async pause(on: boolean): Promise<void> {
		await this.change({ ...this.kept, paused: on });
	}
	async set(id: string, settings: WorkerSettings): Promise<WorkerRecord> {
		const record = { ...Record.parse({ id }), ...this.of(id), ...settings };
		await this.change({
			...this.kept,
			workers: [...this.kept.workers.filter((each) => each.id !== id), record],
		});
		return record;
	}
	private change(kept: KeptFile): Promise<void> {
		this.kept = kept;
		const document = this.document;
		if (document === null) {
			return Promise.resolve();
		}
		this.writing = this.writing
			.catch(() => {})
			.then(() => document.write(kept));
		return this.writing;
	}
}
