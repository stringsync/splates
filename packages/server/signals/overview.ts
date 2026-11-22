import { dotted, projectOf } from "./book";
import type {
	SignalOverview,
	SignalProbe,
	SignalRaise,
	SignalSubscriber,
	SignalWait,
} from "./types";
import { RETENTION_MS } from "./types";

/** One conversation's waits, for the Signals page to list as subscribers. */
export interface WaitsOf {
	conversation: string;
	title: string | null;
	archived: boolean;
	/** The task it runs in now, or null. */
	task: string | null;
	waits: SignalWait[];
}

/** An automation set on a signal, with the slug of its project. */
export interface AutomationOn {
	/** The slug of its project. */
	project: string;
	id: string;
	name: string | null;
	signal: string;
	paused: boolean;
	/** Set once a one-time clock it is on fired. */
	finished?: boolean;
	/** The number of the board task that closes on the signal, when this is one rather than an automation. */
	task?: number;
}

/**
 * Lists every signal that has a raise, a probe or a subscriber, the latest
 * activity first, for the Signals page. A subscriber is live while a wait on
 * it is still waiting (in a conversation not archived, its task not ended),
 * an automation on it is not paused, or a board task that closes on it is open.
 */
export function overview(input: {
	raises: Record<string, SignalRaise[]>;
	probes: SignalProbe[];
	waits: WaitsOf[];
	automations: AutomationOn[];
	now: number;
}): SignalOverview[] {
	const floor = new Date(input.now - RETENTION_MS).toISOString();
	const byName = new Map<string, SignalOverview>();
	const row = (given: string): SignalOverview => {
		const name = dotted(given);
		let found = byName.get(name);
		if (found === undefined) {
			found = {
				name,
				project: projectOf(name),
				probe: null,
				subscribers: [],
				raises: [],
			};
			byName.set(name, found);
		}
		return found;
	};
	for (const [name, list] of Object.entries(input.raises)) {
		row(name).raises = list.filter((one) => one.at >= floor).reverse();
	}
	for (const probe of input.probes) {
		row(probe.name).probe = probe;
	}
	for (const each of input.waits) {
		for (const wait of each.waits) {
			const live =
				wait.state === "waiting" &&
				!each.archived &&
				(wait.task === undefined ||
					wait.task === null ||
					wait.task === each.task);
			if (!live && (wait.endedAt ?? wait.startedAt) < floor) {
				continue;
			}
			const subscriber: SignalSubscriber = {
				kind: "wait",
				id: wait.id,
				label: wait.description,
				state: wait.state,
				...(wait.endedAt === undefined ? {} : { endedAt: wait.endedAt }),
				...(wait.reason === undefined ? {} : { reason: wait.reason }),
				live,
				conversation: each.conversation,
				title: each.title,
				deadline: wait.deadline,
			};
			row(wait.name).subscribers.push(subscriber);
		}
	}
	for (const each of input.automations) {
		if (each.task !== undefined) {
			row(each.signal).subscribers.push({
				kind: "task",
				id: String(each.task),
				label: each.name ?? `Task ${each.task}`,
				state: "open",
				live: true,
				project: each.project,
			});
			continue;
		}
		row(each.signal).subscribers.push({
			kind: "automation",
			id: each.id,
			label: each.name ?? `Automation ${each.id}`,
			state: each.finished ? "finished" : each.paused ? "paused" : "active",
			live: !each.paused && !each.finished,
			project: each.project,
		});
	}
	const newestWait = new Map<string, SignalWait>();
	for (const each of input.waits) {
		for (const wait of each.waits) {
			const name = dotted(wait.name);
			const known = newestWait.get(name);
			if (
				wait.description.trim() !== "" &&
				(known === undefined || wait.startedAt > known.startedAt)
			) {
				newestWait.set(name, wait);
			}
		}
	}
	for (const one of byName.values()) {
		const description =
			one.probe?.description.trim() ||
			newestWait.get(one.name)?.description.trim();
		if (description) {
			one.description = description;
		}
	}
	const latest = (one: SignalOverview): string =>
		[
			one.raises[0]?.at ?? "",
			one.probe?.startedAt ?? "",
			...one.subscribers.map((each) => each.deadline ?? ""),
		].reduce((most, each) => (most > each ? most : each), "");
	const rows = [...byName.values()];
	return rows.sort((first, second) =>
		latest(second).localeCompare(latest(first)),
	);
}
