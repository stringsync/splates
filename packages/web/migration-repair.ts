import { Dispatcher, type Eventful } from "webappwiz/events";
import { ApiError, scoped, send } from "./api";
import type { Feed } from "./feed";
import type { Terminals } from "./terminals";

/** What `/api/migration` says of the project whose records failed to move. */
export interface MigrationSaid {
	failure: {
		from: number;
		to: number;
		step: string | null;
		error: string;
		release: string;
		fallback: string | null;
	} | null;
	/** What Fix with an agent types into its terminal. */
	fix: string | null;
	/** The main tree's branch, which its terminal says it is on. */
	trunk: string;
}

/**
 * The ways on from a project whose records failed to migrate, as its screen
 * offers them: what the server kept of the failure, a retry, and a terminal
 * at the project's root that starts an agent told what failed.
 */
export class MigrationRepair implements Eventful<{ changed: undefined }> {
	private readonly dispatcher = new Dispatcher<{ changed: undefined }>();
	readonly events = this.dispatcher.events;

	/** What the server kept of the failure, once read. */
	said: MigrationSaid | null = null;
	/** Whether a retry is under way. */
	retrying = false;
	/** Why the last retry was refused, or null. */
	refused: string | null = null;
	/** The terminal Fix with an agent opened, while it is shown. */
	fixing: string | null = null;

	constructor(
		private readonly feed: Feed,
		private readonly terminals: Terminals,
	) {}

	/**
	 * Reads what the server kept for the refusal it said as `_refused`, read
	 * again with each new one, as a retry that failed afresh brings.
	 */
	async read(_refused: string): Promise<void> {
		const response = await fetch(scoped("/api/migration")).catch(() => null);
		if (response?.ok) {
			this.set({ said: (await response.json()) as MigrationSaid });
		}
	}

	/** Asks the server to try again, then reads the project as it now stands. */
	async retry(): Promise<void> {
		this.set({ retrying: true, refused: null });
		try {
			await send("/api/migration/retry", {});
			this.set({ retrying: false });
		} catch (error) {
			this.set({
				retrying: false,
				refused: error instanceof ApiError ? error.message : String(error),
			});
		}
		await this.feed.reload();
	}

	/** Opens a terminal at the project's root and starts the agent in it. */
	fix(): void {
		const key = this.terminals.another();
		this.set({ fixing: key });
		if (this.said?.fix) {
			void this.terminals.run(key, null, this.said.fix);
		}
	}

	/** Back to the screen, leaving the terminal running. */
	back(): void {
		this.set({ fixing: null });
	}

	/** Back to the screen, hanging up on the terminal. */
	close(): void {
		if (this.fixing !== null) {
			this.terminals.close(this.fixing);
		}
		this.back();
	}

	private set(next: Partial<MigrationRepair>): void {
		Object.assign(this, next);
		this.dispatcher.dispatch("changed");
	}
}
