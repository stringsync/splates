/** What a chat with an agent takes to mean task `id`. */
export function taskNumberReference(id: number): string {
	return `[SPLATES TASK #${id}]`;
}

/**
 * What opens a conversation the person started by writing on blocked queued
 * task `id`: the agent talks about the task with them and does not take it,
 * and the splates skill says what it means.
 */
export function talkReference(id: number): string {
	return `[SPLATES TALK #${id}]`;
}

/** Read as the Backlog lane where an old saved conversation says `[SPLATES LANE untriaged]`. */
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
 * What opens an agent hook's conversation when signal `name` was raised: the
 * raiser and the payload follow it.
 */
export function signalReference(
	name: string,
	by: string,
	payload: unknown,
): string {
	return `[SPLATES EVENT signal ${name}] raised by ${by}; payload: ${JSON.stringify(payload ?? null)}`;
}

/**
 * What tells the project's groomer to groom ungroomed Backlog task `id`, which
 * `splates server` claimed for it: the splates skill says what it means.
 */
export function groomReference(id: number): string {
	return `[SPLATES GROOM #${id}]`;
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
 * What asks an agent to take merged `task` back off its base, as the merged
 * card's Unmerge sends, with what the person wrote in its dialog after it:
 * the splates skill says what it means, checking first that it can be undone.
 */
export function unmergeReference(task: string, note: string): string {
	const said = note.trim();
	return said === ""
		? `[SPLATES UNMERGE ${task}]`
		: `[SPLATES UNMERGE ${task}]\n\n${said}`;
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

/**
 * What opens a project's conversation that carries on from a General one,
 * whose turns are at `transcript`: it reads them, then works in the project,
 * where the splates skill has it add a task before changing code.
 */
export function continuedReference(transcript: string): string {
	return `This conversation continues one the person started in General, outside any project. What was said there is in ${transcript}: read it, then carry on with that work here, starting a task before changing code.`;
}

/** What a chat with an agent takes to mean "walk the user through setup step `step`". */
export function setupReference(step: string): string {
	return `[SPLATES SETUP ${step}]`;
}

/**
 * What asks an agent to make a change to the project's `splates.config.ts`
 * for a setup step, in a task named `task` so the page can show its diff,
 * and to merge it only once the person has seen the diff and approved.
 */
export function configChangeReference(task: string, change: string): string {
	return `Setup needs a change to this project's \`splates.config.ts\`. Start a task named \`${task}\` with \`splates add ${task}\` and make this change in it, and nothing else: ${change}\n\nThe setup page shows the task's diff to the person. Ask for their review as the splates skill says, and merge once they approve.`;
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
 * What tells an agent a run its run evals card asked for is done, the batch
 * it wrote named, before its condensed report: the splates skill says what it
 * means.
 */
export function evalsDoneReference(batch: string): string {
	return `[SPLATES EVALS DONE ${batch}]`;
}

/**
 * What tells an agent the last task its work was blocked on has ended, so its
 * merge is open again: the splates skill says what it means.
 */
export const BLOCKERS_CLEARED = "[SPLATES BLOCKERS CLEARED]";

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
 * What asks an agent to carry on with a turn a lost connection cut short:
 * send it from the page's Reconnect button, or once the agent's process is
 * lost. The splates skill says what it means.
 */
export const RECONNECT = "[SPLATES RECONNECT]";

/**
 * What approves a task's review and asks the agent to merge it, as the Ready
 * to merge card's Merge button sends: the splates skill says what it means.
 */
export const MERGE = "[SPLATES MERGE]";

/** What an agent hears when the person allows the command its run-command card asked to run. */
export const RUN_ALLOWED = "[SPLATES RUN ALLOWED]";
/**
 * The words after `RUN_ALLOWED` when the server allowed a command for the
 * person, because its card asked only for the machine being busy, which it
 * no longer is. The page shows such a card as auto-allowed.
 */
export const AUTO_ALLOWED = "Auto-allowed by splates";
export const RUN_DENIED = "[SPLATES RUN DENIED]";

/**
 * What tells an agent the person granted its task another round of merge
 * attempts, as `splates retry` does, from its retry card or the refused
 * merge's Grant: the page has granted them already, so the agent merges
 * again. The splates skill says what it means.
 */
export const RETRIED = "[SPLATES RETRIED]";

/** Tells an agent the person answered Yes to its approval question. */
export const APPROVE = "[SPLATES APPROVE]";

/**
 * What asks an agent to make the request after it a queued task rather than do it,
 * or, alone, to make the person's message before it one, with what it did on
 * it since, and stop, as the composer's Defer offers: the splates skill says
 * what it means.
 */
export const DEFER = "[SPLATES DEFER]";

/** Appended to a dictated message for the agent alone, warning it of misheard words. */
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

/** Directive `text` trimmed, in the words splates uses for it today. */
export function directive(text: string): string {
	const trimmed = text.trim();
	const splates = trimmed.startsWith(LEGACY_DIRECTIVE)
		? `[SPLATES ${trimmed.slice(LEGACY_DIRECTIVE.length)}`
		: trimmed;
	return splates.replace(LEGACY_TODO, "[SPLATES TASK ");
}
