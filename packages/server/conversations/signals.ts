import type { Resource } from "core/disposable";
import { Duration } from "core/time";
import { fail } from "../exit";
import type { SignalClock } from "../signals/clock-schedule";
import {
	LONGEST_WAIT_MS,
	type SignalProbe,
	type SignalRaise,
	type SignalWait,
} from "../signals/types";
import type { ConversationDeps, ConversationHost } from "./host";

/** What `splates signal wait` asks for. */
export interface SignalAsk {
	name: string;
	clock?: SignalClock;
	family?: string;
	description: string;
	/** How long it may wait, in milliseconds. */
	timeoutMs: number;
	/** A raise from after this time counts, as an ISO time; null for only later ones. */
	since: string | null;
	/** An earlier raise that `since` already reaches, which ends the wait at once. */
	already?: SignalRaise | null;
}

/** What wakes the agent of a conversation whose wait ended, as the directive its next turn begins with. */
export function wakeOf(wait: SignalWait): string {
	const head = `[SPLATES SIGNAL ${wait.name}]`;
	if (wait.state === "raised" && wait.raise !== undefined) {
		const { by, at, payload } = wait.raise;
		return `${head}\n\nraised by ${by} at ${at}, payload:\n\n${JSON.stringify(payload)}`;
	}
	if (wait.state === "removed") {
		return `${head} removed: ${wait.reason ?? "source removed"}`;
	}
	return `${head} ${wait.state === "stopped" ? "stopped" : "timeout"}`;
}

/**
 * The signals one conversation's agent waits on. Begin a wait with `begin`,
 * end it with `deliver` (a raise) or `stop`; it also ends itself at its
 * deadline. Each ends once, as raised, timed out or stopped, and wakes the
 * agent with what happened. Call `arm` on a conversation read back from its
 * log, so a wait still waiting keeps its deadline.
 */
export class ConversationSignals {
	private readonly timers = new Map<string, Resource>();

	constructor(
		private readonly host: ConversationHost,
		private readonly deps: ConversationDeps,
		/** Says `text` to the agent as the server. */
		private readonly say: (text: string) => Promise<void>,
	) {}

	/** Arms the deadline of each wait a log left waiting. */
	arm(): void {
		for (const wait of this.host.state.signals) {
			if (wait.state === "waiting") {
				this.schedule(wait);
			}
		}
	}

	/** Begins a wait, or ends it at once when `ask` finds a raise already. */
	begin(ask: SignalAsk, id: string): SignalWait {
		if (!Number.isFinite(ask.timeoutMs) || ask.timeoutMs < 1000) {
			fail("usage", "a wait needs a timeout of at least a second", {});
		}
		if (
			ask.timeoutMs >
			(ask.name.startsWith("clock.") ? 365 * 86400000 : LONGEST_WAIT_MS)
		) {
			fail(
				"usage",
				ask.name.startsWith("clock.")
					? "a clock wait may last 1 year at most"
					: "a wait may last 7 days at most",
				{},
			);
		}
		const now = this.host.now();
		const wait: SignalWait = {
			id,
			name: ask.name,
			clock: ask.clock,
			description: ask.description,
			state: "waiting",
			startedAt: now,
			deadline: new Date(this.deps.clock.now() + ask.timeoutMs).toISOString(),
			since: ask.since,
			task: this.host.state.task,
			...(ask.family === undefined ? {} : { family: ask.family }),
		};
		this.keep(wait);
		if (ask.already !== undefined && ask.already !== null) {
			return this.end(wait, "raised", ask.already, true);
		}
		this.schedule(wait);
		return wait;
	}

	/** A raise of `name`: ends every wait on it that began before the raise, and wakes the agent once. */
	deliver(name: string, raise: SignalRaise): number {
		const hit = this.host.state.signals.filter(
			(each) => each.state === "waiting" && each.name === name,
		);
		for (const wait of hit) {
			this.end(wait, "raised", raise, true);
		}
		return hit.length;
	}

	/**
	 * How many waits here subscribe to `name`: those still waiting, in a
	 * conversation not archived, whose task has not ended since they began.
	 */
	subscriptions(name: string): number {
		const { state } = this.host;
		if (state.archived) {
			return 0;
		}
		return state.signals.filter(
			(each) =>
				each.state === "waiting" &&
				each.name === name &&
				(each.task === undefined ||
					each.task === null ||
					each.task === state.task),
		).length;
	}

	/** The probe of `name` timed out: ends every wait on it as timed out, waking the agent. */
	expire(name: string): number {
		const hit = this.host.state.signals.filter(
			(each) => each.state === "waiting" && each.name === name,
		);
		for (const wait of hit) {
			this.end(wait, "timed out", undefined, true);
		}
		return hit.length;
	}

	/** Ends every active wait on a source that can no longer fire. */
	remove(name: string, reason: string): number {
		const hit = this.host.state.signals.filter(
			(each) => each.state === "waiting" && each.name === name,
		);
		for (const wait of hit) {
			this.end({ ...wait, reason }, "removed", undefined, true);
		}
		return hit.length;
	}

	/** Shows `probe` as it stands on its card here, replacing the card of an earlier probe it replaced. */
	showProbe(probe: SignalProbe): void {
		this.host.log.write({ kind: "probe", probe });
		const list = this.host.state.probes;
		const at = list.findIndex(
			(each) => each.name === probe.name && each.startedAt === probe.startedAt,
		);
		if (at >= 0) {
			list[at] = probe;
		} else {
			list.push(probe);
		}
		this.host.changed();
	}

	/** The person stopped waiting on wait `id`. */
	stop(id: string): SignalWait {
		const wait = this.host.state.signals.find((each) => each.id === id);
		if (wait === undefined) {
			fail("not_found", `no wait '${id}' in this conversation`, { id });
		}
		if (wait.state !== "waiting") {
			return wait;
		}
		return this.end(wait, "stopped", undefined, true);
	}

	dispose(): void {
		for (const timer of this.timers.values()) {
			timer.dispose();
		}
		this.timers.clear();
	}

	private schedule(wait: SignalWait): void {
		this.timers.get(wait.id)?.dispose();
		const left = Math.max(0, Date.parse(wait.deadline) - this.deps.clock.now());
		this.timers.set(
			wait.id,
			this.deps.timer.setTimeout(
				() => {
					const live = this.host.state.signals.find(
						(each) => each.id === wait.id,
					);
					if (live?.state === "waiting") {
						if (Date.parse(live.deadline) > this.deps.clock.now()) {
							this.schedule(live);
						} else {
							this.end(live, "timed out", undefined, true);
						}
					}
				},
				Duration.ms(Math.min(left, 2_147_483_647)),
			),
		);
	}

	private end(
		wait: SignalWait,
		state: "raised" | "timed out" | "stopped" | "removed",
		raise: SignalRaise | undefined,
		wake: boolean,
	): SignalWait {
		this.timers.get(wait.id)?.dispose();
		this.timers.delete(wait.id);
		const ended: SignalWait = {
			...wait,
			state,
			endedAt: this.host.now(),
			...(raise === undefined ? {} : { raise }),
		};
		this.keep(ended);
		if (wake) {
			void this.say(wakeOf(ended)).catch(() => {});
		}
		return ended;
	}

	private keep(wait: SignalWait): void {
		this.host.log.write({ kind: "signal", wait });
		const list = this.host.state.signals;
		const at = list.findIndex((each) => each.id === wait.id);
		if (at >= 0) {
			list[at] = wait;
		} else {
			list.push(wait);
		}
		this.host.changed();
	}
}
