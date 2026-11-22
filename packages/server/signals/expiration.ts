import type { Resource } from "core/disposable";
import { Duration, type Timer } from "core/time";
import type { SignalBook } from "./book";

/** Runs persisted removal deadlines, taking back overdue work after restart. */
export class SignalExpiration implements Resource {
	private timer: Resource | undefined;
	private pending: Promise<void> = Promise.resolve();
	private disposed = false;
	constructor(
		private readonly deps: {
			book: SignalBook;
			now(): number;
			timer: Timer;
			remove(name: string): Promise<void>;
			error(error: unknown): void;
		},
	) {}

	/** Resumes automatic removal, including deadlines missed while the server was off. */
	arm(): Promise<void> {
		const run = this.pending.then(() => this.schedule());
		this.pending = run.catch(() => {});
		return run;
	}

	/** Changes a deadline in the same queue as automatic removals. */
	set(name: string, at: string | null): Promise<void> {
		const run = this.pending.then(async () => {
			await this.deps.book.expireAt(name, at);
			await this.schedule();
		});
		this.pending = run.catch(() => {});
		return run;
	}

	private async schedule(): Promise<void> {
		this.timer?.dispose();
		if (this.disposed) {
			return;
		}
		const deadlines = await this.deps.book.expirations();
		let delay = 86_400_000;
		for (const [name, at] of Object.entries(deadlines)) {
			const left = Date.parse(at) - this.deps.now();
			if (left <= 0) {
				try {
					await this.deps.remove(name);
					await this.deps.book.forget(name);
				} catch (error) {
					this.deps.error(error);
					delay = Math.min(delay, 30_000);
				}
			} else {
				delay = Math.min(delay, left);
			}
		}
		if (!this.disposed) {
			this.timer = this.deps.timer.setTimeout(() => {
				void this.arm().catch(this.deps.error);
			}, Duration.ms(delay));
		}
	}

	dispose(): void {
		this.disposed = true;
		this.timer?.dispose();
	}
}
