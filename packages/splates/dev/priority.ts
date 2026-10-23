import { setPriority } from "node:os";
import {
	BESIDE_GATE_NICE,
	PREMERGE_HELD,
} from "@stringsync/splates-server/server";
import type { Ps } from "webappwiz/system";

/** What sets this process's nice: the OS by default, a fake in tests. */
export interface Nicer {
	renice(nice: number): void;
}

/**
 * Puts an agent's own run behind the merge gate: a `dev test` or `dev fix`
 * run from a conversation lowers its own priority to `BESIDE_GATE_NICE`,
 * which every process it spawns inherits, so a gate beside it keeps the CPU.
 * A gate's own run (`SPLATES_PREMERGE`), a `dev premerge` by hand, which
 * holds the premerge lock itself, and the person's runs keep theirs.
 */
export class AgentPriority {
	#lowered = false;

	constructor(
		private readonly ps: Ps,
		private readonly opts: AgentPriorityOptions = {},
	) {}

	/** Lowers the priority when this is an agent's run beside a gate; once. */
	lower(): boolean {
		if (this.#lowered || !this.makesWay()) {
			return false;
		}
		this.#lowered = true;
		const nicer = this.opts.nicer ?? { renice: (nice) => setPriority(nice) };
		nicer.renice(BESIDE_GATE_NICE);
		return true;
	}

	private makesWay(): boolean {
		return (
			!this.opts.premerge &&
			this.ps.env("SPLATES_CONVERSATION") !== undefined &&
			this.ps.env(PREMERGE_HELD) === undefined
		);
	}
}

export interface AgentPriorityOptions {
	/** Whether this run is a `dev premerge`, the gate or its stand-in under the lock, which keeps its priority. */
	premerge?: boolean;
	nicer?: Nicer;
}
