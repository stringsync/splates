import type { RunEvent, RunState } from "@splates/server/ship";
import { applyRunEvent } from "@splates/server/ship/browser";
import type { Resource } from "core/disposable";
import { Dispatcher, type Eventful } from "core/events";
import type { StreamHandlers } from "./live-stream";
import { SHIP_BUS } from "./ship-run-bus";

/** Everything the run view shows, replaced whole on each change. */
export type ShipRunViewState = {
	/** The run as it stands, once the server has said. */
	run: RunState | null;
	/** The server has no run by this id. */
	missing: boolean;
	/** The stream is open; while it is not, the run shown may be behind. */
	live: boolean;
	/** The steps being sent round again, as `target\nstep`. */
	retrying: ReadonlySet<string>;
	/** The steps being sent to an agent, as `target\nstep`. */
	sending: ReadonlySet<string>;
	/** The prompts being answered, each as `target\nstep\nprompt`. */
	answering: ReadonlySet<string>;
	/** Whether Stop was pressed and the server has yet to answer. */
	stopping: boolean;
	/** Whether the supervisor is being given fixes and the server has yet to answer. */
	supervising: boolean;
	/** The reason the server gave for refusing the last action, shown under the run. */
	refused: string | null;
};

export type ShipRunViewEvents = { changed: undefined };

/**
 * Follows ship run `id` live: the state its stream opens with, then each
 * event folded in, afresh on every reopen, so a reload, a lost connection or
 * a restarted server shows the run where it now stands.
 */
export class ShipRunView implements Eventful<ShipRunViewEvents> {
	private readonly dispatcher = new Dispatcher<ShipRunViewEvents>();
	readonly events = this.dispatcher.events;
	state: ShipRunViewState = {
		run: null,
		missing: false,
		live: false,
		retrying: new Set(),
		sending: new Set(),
		answering: new Set(),
		stopping: false,
		supervising: false,
		refused: null,
	};
	/** Asking whether the run is there, after the stream failed. */
	private checking = false;

	constructor(
		private readonly id: string,
		private readonly server: ShipRunServer,
	) {}

	/** Follows the run's stream until disposed; again after, as a remount does. */
	attach(): Resource {
		const connect =
			this.server.connect ??
			((_: string, handlers: StreamHandlers) => this.follow(handlers));
		return connect(this.server.events(this.id), {
			message: () => {},
			dropped: () => this.set({ live: false }),
			error: () => this.check(),
			named: {
				state: (event) =>
					this.set({
						run: JSON.parse(event.data) as RunState,
						missing: false,
						live: true,
					}),
				run: (event) => {
					const { run } = this.state;
					if (run !== null) {
						this.set({
							run: applyRunEvent(run, JSON.parse(event.data) as RunEvent),
						});
					}
				},
			},
		});
	}

	// The page's stream says each change with the state it leaves; the run is
	// read once on each open, since what moved while it was away was never said.
	private follow(handlers: StreamHandlers): Resource {
		const state = handlers.named?.state;
		let disposed = false;
		// Bumped by every state a push brings, so a read begun before it is stale.
		let pushed = 0;
		const read = () => {
			const before = pushed;
			this.server.get(this.id).then(
				(run) => {
					if (disposed || before !== pushed) {
						return;
					}
					if (run === null) {
						this.set({ missing: true });
					} else {
						state?.({ data: JSON.stringify(run) } as MessageEvent<string>);
					}
				},
				() => handlers.error?.(),
			);
		};
		const off = [
			SHIP_BUS.on("run", ({ id, state: run }) => {
				if (id === this.id) {
					pushed++;
					state?.({ data: JSON.stringify(run) } as MessageEvent<string>);
				}
			}),
			SHIP_BUS.on("open", read),
			SHIP_BUS.on("dropped", () => handlers.dropped?.()),
		];
		read();
		return {
			dispose: () => {
				disposed = true;
				for (const unlisten of off) {
					unlisten();
				}
			},
		};
	}

	/** Stops the run; its stream shows it stopped. */
	async stop(): Promise<void> {
		if (this.state.stopping) {
			return;
		}
		this.set({ stopping: true, refused: null });
		let refused: string | null = null;
		try {
			await this.server.stop(this.id);
		} catch (error) {
			refused = error instanceof Error ? error.message : String(error);
		}
		this.set({ stopping: false, refused });
	}

	/** Sends failed step `step` of `target` round again. */
	async retry(target: string, step: string): Promise<void> {
		const key = `${target}\n${step}`;
		if (this.state.retrying.has(key)) {
			return;
		}
		this.set({
			retrying: new Set([...this.state.retrying, key]),
			refused: null,
		});
		try {
			await this.server.retry(this.id, target, step);
			this.settleRetry(key, null);
		} catch (error) {
			this.settleRetry(
				key,
				error instanceof Error ? error.message : String(error),
			);
		}
	}

	/**
	 * Gives the supervisor `fixes` more fixes, as Supervise and + 1 fix do;
	 * a failed step then goes to an agent, and the stream shows it.
	 */
	async supervise(fixes: number): Promise<void> {
		if (this.state.supervising) {
			return;
		}
		this.set({ supervising: true, refused: null });
		let refused: string | null = null;
		try {
			await this.server.supervise(this.id, fixes);
		} catch (error) {
			refused = error instanceof Error ? error.message : String(error);
		}
		this.set({ supervising: false, refused });
	}

	/** Retries every failed step of `target`, as its Retry does. */
	retryFailed(target: { name: string; failed: { id: string }[] }): void {
		for (const step of target.failed) {
			void this.retry(target.name, step.id);
		}
	}

	/** Sends every failed step of `target` to an agent, as its Send to agent does. */
	sendFailed(target: { name: string; failed: { id: string }[] }): void {
		for (const step of target.failed) {
			void this.send(target.name, step.id);
		}
	}

	/**
	 * Sends failed step `step` of `target` to an agent; the ship retries it
	 * once the agent's fix merges. The run's stream shows it sent.
	 */
	async send(target: string, step: string): Promise<void> {
		const key = `${target}\n${step}`;
		if (this.state.sending.has(key)) {
			return;
		}
		this.set({ sending: new Set([...this.state.sending, key]), refused: null });
		let refused: string | null = null;
		try {
			await this.server.send(this.id, target, step);
		} catch (error) {
			refused = error instanceof Error ? error.message : String(error);
		}
		const sending = new Set(this.state.sending);
		sending.delete(key);
		this.set({ sending, refused });
	}

	/** Answers prompt `prompt` that step `step` of `target` waits on with `value`. */
	async answer(
		target: string,
		step: string,
		prompt: string,
		value: unknown,
	): Promise<void> {
		const key = `${target}\n${step}\n${prompt}`;
		if (this.state.answering.has(key)) {
			return;
		}
		this.set({
			answering: new Set([...this.state.answering, key]),
			refused: null,
		});
		let refused: string | null = null;
		try {
			await this.server.answer(this.id, target, step, prompt, value);
		} catch (error) {
			refused = error instanceof Error ? error.message : String(error);
		}
		const answering = new Set(this.state.answering);
		answering.delete(key);
		this.set({ answering, refused });
	}

	private settleRetry(key: string, refused: string | null): void {
		const retrying = new Set(this.state.retrying);
		retrying.delete(key);
		this.set({ retrying, refused });
	}

	/** After the stream failed, whether because the run is not there. */
	private check(): void {
		if (this.checking || this.state.run !== null) {
			return;
		}
		this.checking = true;
		this.server.get(this.id).then(
			(run) => {
				this.checking = false;
				if (run === null) {
					this.set({ missing: true });
				}
			},
			() => {
				this.checking = false;
			},
		);
	}

	private set(change: Partial<ShipRunViewState>): void {
		this.state = { ...this.state, ...change };
		this.dispatcher.dispatch("changed");
	}
}

/** What the run view reads from and asks of the server. */
export interface ShipRunServer {
	/** The address of run `id`'s stream. */
	events(id: string): string;
	/** Run `id`, or null when there is none. */
	get(id: string): Promise<RunState | null>;
	retry(id: string, target: string, step: string): Promise<RunState>;
	/** Stops run `id`. */
	stop(id: string): Promise<RunState>;
	/** Gives the run's supervisor `fixes` more fixes, switching it on when off. */
	supervise(id: string, fixes: number): Promise<RunState>;
	/** Sends failed step `step` to an agent, answering its fix task's number. */
	send(
		id: string,
		target: string,
		step: string,
	): Promise<{ state: RunState; task: number }>;
	answer(
		id: string,
		target: string,
		step: string,
		prompt: string,
		value: unknown,
	): Promise<RunState>;
	/** Opens the run's stream; leave it out to follow the page's own stream. */
	connect?(url: string, handlers: StreamHandlers): Resource;
}
