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
}

/**
 * Every signal that has a raise, a probe or a subscriber, armed ones first
 * and then the latest activity first. A signal is armed while a wait on it
 * is still waiting (in a conversation not archived, its task not ended) or
 * an automation on it is not paused.
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
				armed: false,
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
			const armed =
				wait.state === "waiting" &&
				!each.archived &&
				(wait.task === undefined ||
					wait.task === null ||
					wait.task === each.task);
			if (!armed && (wait.endedAt ?? wait.startedAt) < floor) {
				continue;
			}
			const subscriber: SignalSubscriber = {
				kind: "wait",
				id: wait.id,
				label: wait.description,
				state: wait.state,
				armed,
				conversation: each.conversation,
				title: each.title,
				deadline: wait.deadline,
			};
			row(wait.name).subscribers.push(subscriber);
		}
	}
	for (const each of input.automations) {
		row(each.signal).subscribers.push({
			kind: "automation",
			id: each.id,
			label: each.name ?? `Automation ${each.id}`,
			state: each.paused ? "paused" : "armed",
			armed: !each.paused,
			project: each.project,
		});
	}
	const latest = (one: SignalOverview): string =>
		[
			one.raises[0]?.at ?? "",
			one.probe?.startedAt ?? "",
			...one.subscribers.map((each) => each.deadline ?? ""),
		].reduce((most, each) => (most > each ? most : each), "");
	const rows = [...byName.values()];
	for (const one of rows) {
		one.armed = one.subscribers.some((each) => each.armed);
	}
	return rows.sort(
		(first, second) =>
			Number(second.armed) - Number(first.armed) ||
			latest(second).localeCompare(latest(first)),
	);
}
