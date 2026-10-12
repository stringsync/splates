import type { Resource } from "webappwiz/disposable";
import { Dispatcher, type Eventful } from "webappwiz/events";
import { type Clock, Duration, type Timer } from "webappwiz/time";
import type { Projects } from "./api";
import type { Settings } from "./settings";

export type AutoRestartEvents = { changed: undefined };

/**
 * Where an auto restart stands, as its dialog shows it: nothing to show,
 * counting down to one, waiting on `arbor dev` to come back, or back from
 * one. `onto` names what the restart brings: a commit, or `arbor 1.2.3`.
 */
export type AutoRestartState =
	| { step: "watching" }
	| { step: "counting"; left: Duration; reload: boolean; onto: string }
	| { step: "restarting"; reload: boolean; onto: string }
	| { step: "back"; reloaded: boolean; onto: string };

/** What an auto restart asks of `arbor dev`. */
export interface AutoRestartServer {
	list(): Promise<Projects>;
	/** Restarts it now, refused while an agent is at work. */
	restart(): Promise<void>;
}

/** How long every agent stays idle before a countdown starts. */
export const IDLE = Duration.mins(1);

/** How long the countdown gives the person to cancel. */
export const COUNTDOWN = Duration.mins(1);

/** How often the projects are asked for while nothing is under way. */
const WATCH = Duration.secs(5);

/** How often the countdown moves, and a restart is checked on. */
const TICK = Duration.secs(1);

/** Where a restart that reloads the page leaves what it brought, for after. */
const STORED = "arbor.autoRestarted";

/** The short form of a commit, as git prints it. */
export function short(commit: string): string {
	return commit.slice(0, 8);
}

/**
 * Restarts `arbor dev` on its own once it is out of date, a newer arbor out
 * or commits on the source it runs from, and every agent has been idle for
 * `IDLE`, after a `COUNTDOWN` the person can cancel, as the `restart.auto`
 * setting asks; then reloads the page too when it asks for that, and says it
 * is back either way. Cancelled, it waits for the next thing to restart onto.
 */
export class AutoRestart implements Eventful<AutoRestartEvents>, Resource {
	private readonly dispatcher = new Dispatcher<AutoRestartEvents>();
	readonly events = this.dispatcher.events;

	state: AutoRestartState = { step: "watching" };

	/** When every agent was last seen to go idle; null while one works. */
	private idleSince: Duration | null = null;
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
			/** Where what a reload is back from is kept: the tab's own. */
			storage: Storage;
			reload: () => void;
		},
	) {}

	/** Watches until disposed, saying first what a reload came back from. */
	start(): Resource {
		if (!this.started) {
			this.started = true;
			const onto = this.opts.storage.getItem(STORED);
			if (onto !== null) {
				this.opts.storage.removeItem(STORED);
				this.set({ step: "back", reloaded: true, onto });
			}
		}
		this.ticking?.dispose();
		this.ticking = this.opts.timer.setInterval(() => void this.tick(), TICK);
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

	/** Closes what was said on coming back. */
	dismiss(): void {
		if (this.state.step === "back") {
			this.set({ step: "watching" });
		}
	}

	dispose(): void {
		this.ticking?.dispose();
		this.ticking = null;
	}

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
			if (listed.run !== this.run) {
				this.run = listed.run;
				if (state.reload) {
					this.opts.storage.setItem(STORED, state.onto);
					this.opts.reload();
				} else {
					this.set({ step: "back", reloaded: false, onto: state.onto });
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
		if (
			state.step !== "watching" ||
			mode === "off" ||
			onto === null ||
			onto === this.cancelled ||
			!listed.restartable ||
			this.idleSince === null ||
			now.subtract(this.idleSince).isLessThan(IDLE)
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
 * Whether no agent is at work in any project, and no checkpoint or restart
 * is under way, which a restart would cut into.
 */
function idleIn(listed: Projects): boolean {
	return (
		listed.restarting === null &&
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

/** What a restart now would bring, or null when `arbor dev` is up to date. */
function ontoOf(listed: Projects): string | null {
	return listed.behind !== null
		? short(listed.behind.newest)
		: listed.newest !== null
			? `arbor ${listed.newest}`
			: null;
}
