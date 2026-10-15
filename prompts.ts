import type { AgentPick } from "./roster";

/** What a chat with an agent takes to mean todo `id`. */
export function todoReference(id: number): string {
	return `[ARBOR TODO #${id}]`;
}

/**
 * What the untriaged lane, the todos in no lane, goes by where a lane's
 * number would: `[ARBOR LANE untriaged]`, `arbor lane show untriaged`.
 */
export const UNTRIAGED = "untriaged";

/**
 * What a chat with an agent takes to mean "work down lane `id`", or, for
 * null, "place the untriaged todos in lanes, then work those down".
 */
export function laneReference(id: number | null): string {
	return `[ARBOR LANE ${id ?? UNTRIAGED}]`;
}

/** What a chat with an agent takes to mean "claim `task` and carry on with it". */
export function taskReference(task: string): string {
	return `[ARBOR TASK ${task}]`;
}

/**
 * What a chat with an agent takes to mean "the agent at work on `task` handed
 * it to you: claim it and carry on from where its `ARBOR.md` says it stands".
 */
export function handoffReference(task: string): string {
	return `[ARBOR HANDOFF ${task}]`;
}

/**
 * What asks the agent in a conversation to hand its task off to `pick`'s
 * agent, on its model when it names one, as the page's Hand off action sends.
 */
export function handoffToReference(pick: AgentPick): string {
	return `[ARBOR HANDOFF TO ${pick.agent}${pick.model === undefined ? "" : ` ${pick.model}`}]`;
}

/**
 * What tells the conversation that handed `task` out that it stopped:
 * escalated, merged or removed, which `arbor show` says.
 */
export function reportReference(task: string): string {
	return `[ARBOR REPORT ${task}]`;
}

/**
 * What tells the conversation that handed `task` out that the person
 * terminated its agent, leaving the task as it stood.
 */
export function stoppedReference(task: string): string {
	return `[ARBOR STOPPED ${task}]`;
}

/**
 * What tells the conversation that handed `task` out that its agent's turn
 * ended, or failed, with the task still under way and not escalated, so it
 * waits on nothing that will come.
 */
export function idleReference(task: string): string {
	return `[ARBOR IDLE ${task}]`;
}

/**
 * What asks the conversation that handed tasks out, idle `HEARTBEAT_IDLE` while
 * an agent it handed one to is at work, to check on each and say where its
 * lanes stand.
 */
export const HEARTBEAT = "[ARBOR HEARTBEAT]";

/**
 * Whether `text` is an update arbor itself tells the conversation that handed
 * tasks out: a report, idle, stopped or heartbeat, never the person's word.
 */
export function isUpdate(text: string): boolean {
	return /^\[ARBOR (?:(?:REPORT|IDLE|STOPPED) [^\]]+|HEARTBEAT)\]$/.test(
		text.trim(),
	);
}

/**
 * What asks an agent to bring its `ARBOR.md` up to date and stop, as before a
 * restart: the arbor skill says what it means.
 */
export const CHECKPOINT = "[ARBOR CHECKPOINT]";

/**
 * What asks an agent to carry on from where its `ARBOR.md` says it stopped,
 * after a checkpoint: the arbor skill says what it means.
 */
export const RESUME = "[ARBOR RESUME]";

/**
 * What approves a task's review and asks the agent to merge it, as the Ready
 * to merge card's Merge button sends: the arbor skill says what it means.
 */
export const MERGE = "[ARBOR MERGE]";

/**
 * What asks an agent long at work to say where its work stands and carry on,
 * as the page's Check in button sends: the arbor skill says what it means.
 */
export const CHECK_IN = "[ARBOR UPDATE]";

/** Each `[ARBOR ...]` directive in a text, wherever it stands. */
export const DIRECTIVES = /\[ARBOR [A-Z]+(?: [^\]\s]+)*\]/g;

/** One `[ARBOR ...]` directive at the start of a text, and the space after it. */
const LEADING = /^\s*(\[ARBOR [A-Z]+(?: [^\]\s]+)*\])(?:\s+|$)/;

/**
 * The directives `text` starts with, in order, and what follows them; none
 * when it starts with anything else.
 */
export function leadingDirectives(text: string): {
	directives: string[];
	rest: string;
} {
	const directives: string[] = [];
	let rest = text;
	for (
		let found = LEADING.exec(rest);
		found !== null;
		found = LEADING.exec(rest)
	) {
		directives.push(found[1] as string);
		rest = rest.slice(found[0].length);
	}
	return { directives, rest };
}
