import type { Resource } from "webappwiz/disposable";
import { Dispatcher, type Eventful } from "webappwiz/events";
import {
	type Clock,
	Duration,
	type Timer,
	type WallClock,
} from "webappwiz/time";
import type { Projects } from "./project-api";
import { ontoOf } from "./release";
import type { Settings } from "./settings";

export type AutoRestartEvents = { changed: undefined };

/**
 * Where an auto restart stands, as its dialog shows it: nothing to show,
 * counting down to one, waiting on `arbor dev` to come back, or back from
 * one, `at` epoch ms. `onto` names what the restart brings: a commit, or
 * `arbor 1.2.3`.
 */
export type AutoRestartState =
	| { step: "watching" }
	| { step: "counting"; left: Duration; reload: boolean; onto: string }
	| { step: "restarting"; reload: boolean; onto: string }
	| { step: "back"; reloaded: boolean; onto: string; at: number };

/** What an auto restart asks of `arbor dev`. */
export interface AutoRestartServer {
	list(): Promise<Projects>;
	/** Restarts it now, refused while an agent is at work. */
	restart(): Promise<void>;
}

/**
 * How long every agent, and the person on the page, stay idle before a
 * countdown starts.
 */
export const IDLE = Duration.mins(1);

/** How long the countdown gives the person to cancel. */
export const COUNTDOWN = Duration.mins(1);

/** What counts as the person at work on the page. */
const INPUT = ["keydown", "pointerdown", "wheel", "touchstart"];

/** How often the projects are asked for while nothing is under way. */
const WATCH = Duration.secs(5);

/** How often the countdown moves, and a restart is checked on. */
const TICK = Duration.secs(1);

/**
 * Where a restart that reloads the page leaves what it brought and when, for
 * after.
 */
const STORED = "arbor.autoRestarted";

/**
 * Restarts `arbor dev` on its own once it is out of date, a newer arbor out
 * or commits on the source it runs from, and every agent and the person on
 * the page have been idle for `IDLE`, after a `COUNTDOWN` the person can cancel, as the `restart.auto`
 * setting asks; then reloads the page too when it asks for that, and says it
 * is back either way, until the next countdown. Cancelled, it waits for the
 * next thing to restart onto.
 */
export class AutoRestart implements Eventful<AutoRestartEvents>, Resource {
	private readonly dispatcher = new Dispatcher<AutoRestartEvents>();
	readonly events = this.dispatcher.events;

	state: AutoRestartState = { step: "watching" };

	/** When every agent was last seen to go idle; null while one works. */
	private idleSince: Duration | null = null;
	/** When the person last pressed, clicked, scrolled or touched the page. */
	private inputAt: Duration;
	private listedAt: Duration | null = null;
	private deadline: Duration | null = null;
	/** The run of `arbor dev` last listed, which a restart replaces. */
	private run: string | null = null;
	/** What a cancelled countdown was onto, so it is not offered again. */
	private cancelled: string | null = null;
	private listing = false;
	private ticking: Resource | null = null;
	private started = false;

	constructor(
		private readonly server: AutoRestartServer,
		private readonly settings: Settings,
		private readonly opts: {
			timer: Timer;
			clock: Clock;
			/** When a restart came back, as the dialog says how long ago. */
			wall: WallClock;
			/** Where the person's input is heard: the window. */
			input: EventTarget;
			/** Where what a reload is back from is kept: the tab's own. */
			storage: Storage;
			reload: () => void;
		},
	) {
		this.inputAt = opts.clock.now();
	}

	/** Watches until disposed, saying first what a reload came back from. */
	start(): Resource {
		if (!this.started) {
			this.started = true;
			const stored = this.opts.storage.getItem(STORED);
			if (stored !== null) {
				this.opts.storage.removeItem(STORED);
				const { onto, at } = JSON.parse(stored) as { onto: string; at: number };
				this.set({ step: "back", reloaded: true, onto, at });
			}
		}
		this.ticking?.dispose();
		this.ticking = this.opts.timer.setInterval(() => void this.tick(), TICK);
		for (const each of INPUT) {
			this.opts.input.addEventListener(each, this.heard, { passive: true });
		}
		return { dispose: () => this.dispose() };
	}

	/** Stops the countdown; the same restart is not offered again. */
	cancel(): void {
		if (this.state.step === "counting") {
			this.cancelled = this.state.onto;
			this.set({ step: "watching" });
		}
	}

	/** Restarts now rather than at the end of the countdown. */
	async restartNow(): Promise<void> {
		if (this.state.step !== "counting") {
			return;
		}
		const { reload, onto } = this.state;
		this.set({ step: "restarting", reload, onto });
		try {
			await this.server.restart();
		} catch (error) {
			// Gone before it answered, as it stopped to restart.
			if (error instanceof TypeError) {
				return;
			}
			// An agent went to work meanwhile: idle starts over.
			this.idleSince = null;
			this.set({ step: "watching" });
		}
	}

	/** How long ago the restart it is back from came back; null if not back. */
	ago(): Duration | null {
		return this.state.step === "back"
			? Duration.ms(this.opts.wall.now() - this.state.at)
			: null;
	}

	/** Closes what was said on coming back. */
	dismiss(): void {
		if (this.state.step === "back") {
			this.set({ step: "watching" });
		}
	}

	dispose(): void {
		this.ticking?.dispose();
		this.ticking = null;
		for (const each of INPUT) {
			this.opts.input.removeEventListener(each, this.heard);
		}
	}

	private readonly heard = (): void => {
		this.inputAt = this.opts.clock.now();
	};

	private async tick(): Promise<void> {
		const now = this.opts.clock.now();
		const mode = this.settings.get("restart.auto");
		if (this.state.step === "counting" && this.deadline !== null) {
			if (mode === "off") {
				this.set({ step: "watching" });
				return;
			}
			if (now.isGreaterThanOrEqual(this.deadline)) {
				await this.restartNow();
				return;
			}
			this.set({
				...this.state,
				left: this.deadline.subtract(now),
				reload: mode === "reload",
			});
		}
		if (mode === "off" && this.state.step !== "restarting") {
			return;
		}
		if (
			this.listing ||
			((this.state.step === "watching" || this.state.step === "back") &&
				this.listedAt !== null &&
				now.subtract(this.listedAt).isLessThan(WATCH))
		) {
			return;
		}
		this.listing = true;
		let listed: Projects;
		try {
			listed = await this.server.list();
		} catch {
			// Down, as while it restarts: the next tick asks again.
			return;
		} finally {
			this.listing = false;
		}
		this.listedAt = now;
		this.look(listed, this.opts.clock.now());
	}

	private look(listed: Projects, now: Duration): void {
		const state = this.state;
		if (state.step === "restarting") {
			if (listed.run !== this.run) {
				this.run = listed.run;
				// Idle counts afresh from the new run.
				this.idleSince = null;
				const at = this.opts.wall.now();
				if (state.reload) {
					this.opts.storage.setItem(
						STORED,
						JSON.stringify({ onto: state.onto, at }),
					);
					this.opts.reload();
				} else {
					this.set({ step: "back", reloaded: false, onto: state.onto, at });
				}
			}
			return;
		}
		this.run = listed.run;
		const idle = idleIn(listed);
		this.idleSince = idle ? (this.idleSince ?? now) : null;
		const onto = ontoOf(listed);
		if (state.step === "counting") {
			if (!idle || onto === null) {
				this.set({ step: "watching" });
			}
			return;
		}
		const mode = this.settings.get("restart.auto");
		// Watching, or back from the last restart, which gives way to the next
		// one's countdown.
		if (
			mode === "off" ||
			onto === null ||
			onto === this.cancelled ||
			!listed.restartable ||
			this.idleSince === null ||
			now.subtract(this.idleSince).isLessThan(IDLE) ||
			now.subtract(this.inputAt).isLessThan(IDLE)
		) {
			return;
		}
		this.deadline = now.add(COUNTDOWN);
		this.set({
			step: "counting",
			left: COUNTDOWN,
			reload: mode === "reload",
			onto,
		});
	}

	private set(state: AutoRestartState): void {
		this.state = state;
		this.dispatcher.dispatch("changed");
	}
}

/**
 * Whether no agent is at work in any project, no command runs that a restart
 * would kill, and no checkpoint or restart is under way, which a restart
 * would cut into.
 */
function idleIn(listed: Projects): boolean {
	return (
		listed.restarting === null &&
		listed.held.length === 0 &&
		listed.projects.every((project) =>
			project.conversations.every(
				(each) =>
					each.status !== "running" &&
					each.status !== "starting" &&
					each.checkpoint !== "asked",
			),
		)
	);
}
