import { Dispatcher, type Eventful } from "webappwiz/events";
import { importConfig, uploadPart } from "./api";

/** Characters to a part: three bytes each at most, under the server's 25 MB a request. */
const PART = 6_000_000;

/** Where an import stands. */
export type ImportState =
	| { kind: "idle" }
	| { kind: "sending"; share: number }
	| { kind: "importing" }
	| { kind: "conflicts"; conflicts: string[] }
	| { kind: "done"; written: number; kept: number; asked: string[] }
	| { kind: "failed"; message: string };

export type SetupImportEvents = { changed: undefined };

/**
 * Importing an export on Setup: sends the file in parts, since it outgrows
 * one request, then imports it, stopping on files here that differ until
 * the person overwrites them or cancels.
 */
export class SetupImport implements Eventful<SetupImportEvents> {
	private readonly dispatcher = new Dispatcher<SetupImportEvents>();
	readonly events = this.dispatcher.events;

	state: ImportState = { kind: "idle" };
	/** The upload a conflict waits on, for `overwrite`. */
	private upload: string | null = null;

	get busy(): boolean {
		return this.state.kind === "sending" || this.state.kind === "importing";
	}

	/** Sends `file` and imports it. */
	async choose(file: File): Promise<void> {
		await this.attempt(async () => {
			this.set({ kind: "sending", share: 0 });
			const text = await file.text();
			const upload = crypto.randomUUID();
			const parts = Math.max(1, Math.ceil(text.length / PART));
			for (let part = 0; part < parts; part++) {
				await uploadPart(
					upload,
					part,
					text.slice(part * PART, (part + 1) * PART),
				);
				this.set({ kind: "sending", share: (part + 1) / parts });
			}
			this.upload = upload;
			await this.run(false);
		});
	}

	/** Imports the file sent, overwriting what differs here. */
	async overwrite(): Promise<void> {
		await this.attempt(() => this.run(true));
	}

	cancel(): void {
		this.upload = null;
		this.set({ kind: "idle" });
	}

	private async run(force: boolean): Promise<void> {
		if (this.upload === null) {
			return;
		}
		this.set({ kind: "importing" });
		const done = await importConfig(this.upload, force);
		if ("conflicts" in done) {
			this.set({ kind: "conflicts", conflicts: done.conflicts });
			return;
		}
		this.upload = null;
		this.set({
			kind: "done",
			written: done.written.length,
			kept: done.kept.length,
			asked: done.asked,
		});
	}

	private async attempt(work: () => Promise<void>): Promise<void> {
		try {
			await work();
		} catch (error) {
			this.set({
				kind: "failed",
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}

	private set(state: ImportState): void {
		this.state = state;
		this.dispatcher.dispatch("changed");
	}
}
