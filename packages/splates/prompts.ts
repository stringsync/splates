import type { AgentPick } from "./roster";

/** What a chat with an agent takes to mean todo `id`. */
export function todoReference(id: number): string {
	return `[SPLATES TODO #${id}]`;
}

/**
 * What the untriaged lane, the todos in no lane, goes by where a lane's
 * number would: `[SPLATES LANE untriaged]`, `splates lane show untriaged`.
 */
export const UNTRIAGED = "untriaged";

/**
 * What a chat with an agent takes to mean "work down lane `id`", or, for
 * null, "place the untriaged todos in lanes, then work those down".
 */
export function laneReference(id: number | null): string {
	return `[SPLATES LANE ${id ?? UNTRIAGED}]`;
}

/** What a chat with an agent takes to mean "claim `task` and carry on with it". */
export function taskReference(task: string): string {
	return `[SPLATES TASK ${task}]`;
}

/** What a chat with an agent takes to mean "walk the user through setup step `step`". */
export function setupReference(step: string): string {
	return `[SPLATES SETUP ${step}]`;
}

/**
 * What a chat with an agent takes to mean "the agent at work on `task` handed
 * it to you: claim it and carry on from where its `SPLATES.md` says it stands".
 */
export function handoffReference(task: string): string {
	return `[SPLATES HANDOFF ${task}]`;
}

/**
 * What asks the agent in a conversation to hand its task off to `pick`'s
 * agent, on its model when it names one, as the page's Hand off action sends.
 */
export function handoffToReference(pick: AgentPick): string {
	return `[SPLATES HANDOFF TO ${pick.agent}${pick.model === undefined ? "" : ` ${pick.model}`}]`;
}

/**
 * What tells the conversation that handed `task` out that it stopped:
 * escalated, merged or removed, which `splates show` says.
 */
export function reportReference(task: string): string {
	return `[SPLATES REPORT ${task}]`;
}

/**
 * What tells the conversation that handed `task` out that the person
 * terminated its agent, leaving the task as it stood.
 */
export function stoppedReference(task: string): string {
	return `[SPLATES STOPPED ${task}]`;
}

/**
 * What tells the conversation that handed `task` out that its agent's turn
 * ended, or failed, with the task still under way and not escalated, so it
 * waits on nothing that will come.
 */
export function idleReference(task: string): string {
	return `[SPLATES IDLE ${task}]`;
}

/**
 * What asks the conversation that handed tasks out, idle `HEARTBEAT_IDLE` while
 * an agent it handed one to is at work, to check on each and say where its
 * lanes stand.
 */
export const HEARTBEAT = "[SPLATES HEARTBEAT]";

/**
 * What tells a lane's orchestrator that todo `id`, in a lane it works, left
 * the list: merged, or removed.
 */
export function todoDoneReference(id: number): string {
	return `[SPLATES TODO DONE #${id}]`;
}

/**
 * What tells a lane's orchestrator that todo `id`, in a lane it works, is
 * open again: the task that took it released it or was removed.
 */
export function todoOpenReference(id: number): string {
	return `[SPLATES TODO OPEN #${id}]`;
}

/**
 * What tells a lane's orchestrator that every lane it works is done, however
 * the last todo landed, so it ends on its Finished report.
 */
export const LANES_DONE = "[SPLATES LANES DONE]";

/**
 * Whether `text` is an update splates itself tells the conversation that handed
 * tasks out: a report, idle, stopped, a todo done or open, heartbeat or
 * lanes done, never the person's word.
 */
export function isUpdate(text: string): boolean {
	return /^\[(?:SPLATES|ARBOR) (?:(?:REPORT|IDLE|STOPPED) [^\]]+|TODO (?:DONE|OPEN) #\d+|HEARTBEAT|LANES DONE)\]$/.test(
		text.trim(),
	);
}

/**
 * What asks an agent to bring its `SPLATES.md` up to date and stop, as before a
 * restart: the splates skill says what it means.
 */
export const CHECKPOINT = "[SPLATES CHECKPOINT]";

/**
 * What asks an agent to carry on from where its `SPLATES.md` says it stopped,
 * after a checkpoint: the splates skill says what it means.
 */
export const RESUME = "[SPLATES RESUME]";

/**
 * What asks an agent to carry on with a turn a lost connection cut short, as
 * the page's Reconnect button sends: the splates skill says what it means.
 */
export const RECONNECT = "[SPLATES RECONNECT]";

/**
 * What approves a task's review and asks the agent to merge it, as the Ready
 * to merge card's Merge button sends: the splates skill says what it means.
 */
export const MERGE = "[SPLATES MERGE]";

/**
 * What approves an agent's proposal as it stands and asks it to go ahead,
 * the answers to any calls it chose nothing for after it, as the Proposed
 * card's Approve button sends: the splates skill says what it means.
 */
export const APPROVE = "[SPLATES APPROVE]";

/**
 * What asks an agent long at work to say where its work stands and carry on,
 * as the page's Check in button sends: the splates skill says what it means.
 */
export const CHECK_IN = "[SPLATES UPDATE]";

/**
 * What asks an agent to make the request after it a todo rather than do it,
 * or, alone, to make the person's message before it one, with what it did on
 * it since, and stop, as the composer's Defer offers: the splates skill says
 * what it means.
 */
export const DEFER = "[SPLATES DEFER]";

/**
 * What the agent alone is told of a message the person dictated: the page
 * marks it with a mic, and never shows these words.
 */
export const DICTATED =
	"(Dictated by voice: words that sound alike may be swapped, and names in this project misspelled. Read a near miss as the closest name in the project, and ask before acting on a reading that changes what you do.)";

/** Each `[SPLATES ...]` directive in a text, wherever it stands. */
export const DIRECTIVES = /\[(?:SPLATES|ARBOR) [A-Z]+(?: [^\]\s]+)*\]/g;

/** One `[SPLATES ...]` directive at the start of a text, and the space after it. */
const LEADING = /^\s*(\[(?:SPLATES|ARBOR) [A-Z]+(?: [^\]\s]+)*\])(?:\s+|$)/;

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
		directives.push(directive(found[1] as string));
		rest = rest.slice(found[0].length);
	}
	return { directives, rest };
}

/** arbor's directive prefix, read as splates's for one release. */
const LEGACY_DIRECTIVE = "[ARBOR ";

/**
 * `text` trimmed, read as splates's directive when it is one of arbor's, as a
 * conversation from before the rename holds.
 */
export function directive(text: string): string {
	const trimmed = text.trim();
	return trimmed.startsWith(LEGACY_DIRECTIVE)
		? `[SPLATES ${trimmed.slice(LEGACY_DIRECTIVE.length)}`
		: trimmed;
}
