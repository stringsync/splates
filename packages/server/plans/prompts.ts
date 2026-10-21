/** What a chat with an agent takes to mean task `id`. */
export function taskNumberReference(id: number): string {
	return `[SPLATES TASK #${id}]`;
}

/**
 * What the untriaged lane, the tasks in no lane, goes by where a lane's
 * number would: `[SPLATES LANE untriaged]`, `splates lane show untriaged`.
 */
export const UNTRIAGED = "untriaged";

/**
 * What opens the conversation a hook starts on task event `name`, about the
 * queued tasks `numbers` and the started `task`, before the hook's prompt.
 */
export function eventReference(
	name: string,
	numbers: readonly number[],
	task: string | null,
): string {
	const about = [
		...numbers.map((id) => `#${id}`),
		...(task === null ? [] : [task]),
	];
	return `[SPLATES EVENT ${[name, ...about].join(" ")}]`;
}

/**
 * What opens the conversation an automation starts when its schedule comes
 * due, named by the automation's number, before its prompt.
 */
export function scheduleReference(automation: string): string {
	return `[SPLATES SCHEDULE ${automation}]`;
}

/**
 * What opens the conversation the notes gardener starts, before the paths
 * of the notes it reads: the splates skill says what it means.
 */
export const GARDEN = "[SPLATES GARDEN]";

/**
 * What tells the project's groomer to groom backlog task `id`, which
 * `splates server` claimed for it: the splates skill says what it means.
 */
export function groomReference(id: number): string {
	return `[SPLATES GROOM #${id}]`;
}

/**
 * What tells the project's groomer to look for lanes for Untriaged tasks
 * `ids`, which `splates server` marked as looked at: the splates skill says
 * what it means.
 */
export function sortReference(ids: readonly number[]): string {
	return `[SPLATES SORT ${ids.map((id) => `#${id}`).join(" ")}]`;
}

/** What a chat with an agent takes to mean "claim `task` and carry on with it". */
export function taskReference(task: string): string {
	return `[SPLATES TASK ${task}]`;
}

/** Where a demo shows a task: just before its change, with it, or on main now. */
export type DemoPoint = "before" | "after" | "main";

/**
 * What asks an agent to set up a demo of `task` at `point`, as the task
 * dialog's Demo buttons send: the splates skill says what it means.
 */
export function demoReference(task: string, point: DemoPoint): string {
	return `[SPLATES DEMO ${task} ${point}]`;
}

/**
 * What a chat with an agent takes to mean "claim `task` and carry on with
 * it" from an agent that stopped on it without handing it over, whose last
 * turns are at `transcript`.
 */
export function handOffReference(task: string, transcript: string): string {
	return `${taskReference(task)}

The agent before you on this task stopped without handing it over, so its SPLATES.md may be behind. What it said and did last is in ${transcript}: read its end before going on.`;
}

/** What a chat with an agent takes to mean "walk the user through setup step `step`". */
export function setupReference(step: string): string {
	return `[SPLATES SETUP ${step}]`;
}

/**
 * Whether `text` is an update splates itself tells the conversation that handed
 * tasks out: a report, or, in a conversation from before lanes stopped
 * running, idle, a task done, open, added, to groom or to sort, or lanes
 * done; never the person's word.
 */
export function isUpdate(text: string): boolean {
	return /^\[SPLATES (?:(?:REPORT|IDLE) [^\]]+|TASK (?:DONE|OPEN|ADDED) #\d+|GROOM #\d+|SORT(?: #\d+)+|LANES DONE)\]$/.test(
		directive(text),
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
 * the page's Reconnect button sends, and splates does by itself once the
 * agent's process is lost: the splates skill says what it means.
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
 * What asks an agent to make the request after it a queued task rather than do it,
 * or, alone, to make the person's message before it one, with what it did on
 * it since, and stop, as the composer's Defer offers: the splates skill says
 * what it means.
 */
export const DEFER = "[SPLATES DEFER]";

/**
 * What asks an agent to draft a project note from the conversation and wait
 * for the person's approval before merging it, as Keep this sends.
 */
export const KEEP = "[SPLATES KEEP]";

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

/** A todo's directive from before todos became tasks, read as a task's. */
const LEGACY_TODO = /^\[SPLATES TODO (?=(?:(?:DONE|OPEN|ADDED) )?#\d+\]$)/;

/**
 * `text` trimmed, read as splates's directive when it is one of arbor's, and
 * as a task's when it is a todo's, as a conversation from before either
 * rename holds.
 */
export function directive(text: string): string {
	const trimmed = text.trim();
	const splates = trimmed.startsWith(LEGACY_DIRECTIVE)
		? `[SPLATES ${trimmed.slice(LEGACY_DIRECTIVE.length)}`
		: trimmed;
	return splates.replace(LEGACY_TODO, "[SPLATES TASK ");
}
