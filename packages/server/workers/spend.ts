import { Duration } from "webappwiz/time";

/** One made worker's life, as the ledger keeps it. */
export interface SpendLife {
	id: string;
	dollarsPerHour: number;
	/** Epoch ms. */
	from: number;
	/** Epoch ms; null while it runs. */
	until: number | null;
}

/** One agent's time holding a slot on a made worker, as the ledger keeps it. */
export interface SpendRun {
	/** The conversation's id. */
	conversation: string;
	/** The project's main tree. */
	project: string;
	task: string | null;
	worker: string;
	/** Epoch ms. */
	from: number;
	/** Epoch ms; null while it holds the slot. */
	until: number | null;
}

/**
 * What made workers cost one project's task, or a project's conversations
 * with no task when `task` is null, or no one at all, idle, when `project`
 * is null.
 */
export interface SpendShare {
	project: string | null;
	task: string | null;
	dollars: number;
	/** Slot-hours its agents held on made workers. */
	slotHours: number;
	/** Always true for now: counted at the provider's list price, not its bill. */
	estimate: boolean;
}

/**
 * Who made workers' cost from `since` to `now` went to, the most first.
 * Each worker's cost is counted clock hour by clock hour, and an hour's
 * cost goes to the runs on the worker in that hour by how long each held
 * its slot, so the time it sat idle is shared among the tasks that ran on
 * it that hour. An hour nothing ran in goes to an idle share of its own.
 */
export function splitSpend(
	lives: readonly SpendLife[],
	runs: readonly SpendRun[],
	since: number,
	now: number,
): SpendShare[] {
	const shares = new Map<string, SpendShare>();
	const add = (
		project: string | null,
		task: string | null,
		dollars: number,
		slotHours: number,
	): void => {
		const key = JSON.stringify([project, task]);
		const share = shares.get(key) ?? {
			project,
			task,
			dollars: 0,
			slotHours: 0,
			estimate: true,
		};
		share.dollars += dollars;
		share.slotHours += slotHours;
		shares.set(key, share);
	};
	for (const life of lives) {
		const from = Math.max(life.from, since);
		const until = Math.min(life.until ?? now, now);
		const on = runs.filter((run) => run.worker === life.id);
		for (let hour = hourOf(from); hour < until; hour += HOUR) {
			const start = Math.max(hour, from);
			const end = Math.min(hour + HOUR, until);
			if (end <= start) {
				continue;
			}
			const cost = (life.dollarsPerHour * (end - start)) / HOUR;
			const held = on
				.map((run) => ({
					run,
					ms: overlap(run.from, run.until ?? now, start, end),
				}))
				.filter(({ ms }) => ms > 0);
			const total = held.reduce((sum, { ms }) => sum + ms, 0);
			if (total === 0) {
				add(null, null, cost, 0);
				continue;
			}
			for (const { run, ms } of held) {
				add(run.project, run.task, (cost * ms) / total, ms / HOUR);
			}
		}
	}
	return [...shares.values()].sort((one, other) => other.dollars - one.dollars);
}

const HOUR = Duration.hrs(1).ms;

/** The start of the local clock hour `at` falls in. */
function hourOf(at: number): number {
	const date = new Date(at);
	date.setMinutes(0, 0, 0);
	return date.getTime();
}

function overlap(from: number, until: number, start: number, end: number) {
	return Math.max(0, Math.min(until, end) - Math.max(from, start));
}
