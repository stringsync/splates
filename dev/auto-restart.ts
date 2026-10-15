import type { Resource } from "webappwiz/disposable";
import { Dispatcher, type Eventful } from "webappwiz/events";
import { type Clock, Duration, type Timer } from "webappwiz/time";
import type { Projects } from "./project-api";
import { ontoOf } from "./release";
import type { Settings } from "./settings";

export type AutoRestartEvents = { changed: undefined };

/**
 * Where an auto restart stands, as Power shows it: nothing to show, counting
 * down to one, or gone to restart the `run` of `arbor dev` listed last, which
 * Power then sees through. `onto` names what the restart brings: a commit,
 * or `arbor 1.2.3`.
 */
export type AutoRestartState =
	| { step: "watching" }
	| { step: "counting"; left: Duration; run: string; onto: string }
	| { step: "restarting"; run: string; onto: string };

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

/** How often the countdown moves. */
const TICK = Duration.secs(1);

/**
 * Restarts `arbor dev` on its own once it is out of date, a newer arbor out
 * or commits on the source it runs from, and every agent and the person on
 * the page have been idle for `IDLE`, after a `COUNTDOWN` the person can
 * cancel, as the `restart.auto` setting asks, and never while held, as while
 * Power is open. Once gone to restart, Power waits on it and reloads the page.
 * Cancelled, it waits for the next thing to restart onto.
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
	/** What a cancelled countdown was onto, so it is not offered again. */
	private cancelled: string | null = null;
	/** Whether no countdown may start, as while Power is open. */
	private held = false;
	/** Whether a restart has been asked for and not yet answered. */
	private asking = false;
	private listing = false;
	private ticking: Resource | null = null;

	constructor(
		private readonly server: AutoRestartServer,
		private readonly settings: Settings,
		private readonly opts: AutoRestartOptions,
	) {
		this.inputAt = opts.clock.now();
	}

	/** Watches until disposed. */
	start(): Resource {
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
		if (this.state.step !== "counting" || this.asking) {
			return;
		}
		const { run, onto } = this.state;
		this.asking = true;
		try {
			await this.server.restart();
			this.set({ step: "restarting", run, onto });
		} catch (error) {
			// Gone before it answered, as it stopped to restart.
			if (error instanceof TypeError) {
				this.set({ step: "restarting", run, onto });
				return;
			}
			// An agent went to work meanwhile: idle starts over.
			this.idleSince = null;
			this.set({ step: "watching" });
		} finally {
			this.asking = false;
		}
	}

	/** Starts no countdown while `held`, as while Power is open. */
	hold(held: boolean): void {
		this.held = held;
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
		const on = this.settings.get("restart.auto");
		if (this.state.step === "counting" && this.deadline !== null) {
			if (!on) {
				this.set({ step: "watching" });
				return;
			}
			if (now.isGreaterThanOrEqual(this.deadline)) {
				await this.restartNow();
				return;
			}
			this.set({ ...this.state, left: this.deadline.subtract(now) });
		}
		if (
			!on ||
			this.state.step === "restarting" ||
			this.listing ||
			(this.state.step === "watching" &&
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
			return;
		}
		const idle = idleIn(listed);
		this.idleSince = idle ? (this.idleSince ?? now) : null;
		const onto = ontoOf(listed);
		if (state.step === "counting") {
			if (!idle || onto === null) {
				this.set({ step: "watching" });
			}
			return;
		}
		if (
			this.held ||
			!this.settings.get("restart.auto") ||
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
		this.set({ step: "counting", left: COUNTDOWN, run: listed.run, onto });
	}

	private set(state: AutoRestartState): void {
		this.state = state;
		this.dispatcher.dispatch("changed");
	}
}

/** What an `AutoRestart` keeps time with, and hears the person on. */
export interface AutoRestartOptions {
	timer: Timer;
	clock: Clock;
	/** Where the person's input is heard: the window. */
	input: EventTarget;
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
