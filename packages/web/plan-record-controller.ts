import type { RecOpen, RecState } from "@splates/server/rec/browser";
import type { Resource } from "core/disposable";
import { Dispatcher, type Eventful } from "core/events";
import { Duration, SystemTimer, type Timer } from "core/time";
import { closeRec, openRec, recName, recState } from "./api/rec";

export type PlanRecordPhase =
	| { at: "idle" }
	| { at: "starting" }
	| { at: "recording"; name: string }
	| { at: "stopping"; name: string }
	| { at: "saved"; name: string }
	| { at: "failed"; reason: string };

export type PlanRecordEvents = { changed: undefined };

/** The rec requests a plan recording makes, for tests to stand in for. */
export interface PlanRecordApi {
	state(): Promise<RecState>;
	name(): Promise<string>;
	open(what: RecOpen): Promise<void>;
	close(): Promise<void>;
}

const REC: PlanRecordApi = {
	state: recState,
	name: recName,
	open: openRec,
	close: closeRec,
};

const POLL = Duration.ms(2000);

/**
 * Records a review of a plan: opens it in rec's Chrome, follows rec while it
 * records and while it saves after Stop, and holds the saved session's name
 * until it is added to the answer. `check` reads whether rec is there at all.
 */
export class PlanRecordController
	implements Eventful<PlanRecordEvents>, Resource
{
	private readonly dispatcher = new Dispatcher<PlanRecordEvents>();
	readonly events = this.dispatcher.events;

	available = false;
	phase: PlanRecordPhase = { at: "idle" };

	private poll: Resource | null = null;
	private disposed = false;

	constructor(
		private readonly rec: PlanRecordApi = REC,
		private readonly timer: Timer = new SystemTimer(),
	) {}

	/** Reads whether rec is on the server's machine. */
	check(): void {
		this.rec.state().then(
			(state) => {
				if (!this.disposed) {
					this.available = state.available;
					this.changed();
				}
			},
			() => {},
		);
	}

	/** Opens `url` in rec's Chrome under a fresh session name. */
	async start(url: string): Promise<void> {
		this.set({ at: "starting" });
		try {
			const name = await this.rec.name();
			await this.rec.open({ name, url, docker: [], tails: [] });
			this.set({ at: "recording", name });
		} catch (error) {
			this.set({ at: "failed", reason: (error as Error).message });
		}
	}

	/** Asks rec to stop, showing it stopping until it has saved or failed. */
	async stop(): Promise<void> {
		if (this.phase.at !== "recording") {
			return;
		}
		const { name } = this.phase;
		this.set({ at: "stopping", name });
		try {
			await this.rec.close();
		} catch {
			// The poll may have moved on while the request was out.
			if (this.isStopping(name)) {
				this.set({ at: "recording", name });
			}
		}
	}

	/** The saved session's reference, once taken, back to idle. */
	take(): string | null {
		if (this.phase.at !== "saved") {
			return null;
		}
		const reference = `#rec:${this.phase.name}`;
		this.set({ at: "idle" });
		return reference;
	}

	dispose(): void {
		this.disposed = true;
		this.poll?.dispose();
		this.poll = null;
	}

	private set(phase: PlanRecordPhase): void {
		if (this.disposed) {
			return;
		}
		this.phase = phase;
		const following = phase.at === "recording" || phase.at === "stopping";
		if (following && this.poll === null) {
			this.poll = this.timer.setInterval(() => this.follow(), POLL);
		} else if (!following) {
			this.poll?.dispose();
			this.poll = null;
		}
		this.changed();
	}

	// While Chrome is open and while rec saves, follow it until it saves or fails.
	private follow(): void {
		this.rec.state().then(
			({ status }) => {
				const phase = this.phase;
				if (
					status.running ||
					(phase.at !== "recording" && phase.at !== "stopping")
				) {
					return;
				}
				const outcome = status.lastOutcome;
				if (outcome?.status === "saved" && outcome.name === phase.name) {
					this.set({ at: "saved", name: phase.name });
				} else if (outcome?.status === "failed") {
					this.set({ at: "failed", reason: outcome.reason });
				} else if ((status.processing ?? []).length === 0) {
					this.set({ at: "idle" });
				} else if (phase.at === "recording") {
					this.set({ at: "stopping", name: phase.name });
				}
			},
			() => {},
		);
	}

	private isStopping(name: string): boolean {
		return this.phase.at === "stopping" && this.phase.name === name;
	}

	private changed(): void {
		this.dispatcher.dispatch("changed");
	}
}
