import type { Question } from "../plans";
import type { FailedTest, RemoveReason } from "../tasks";

/** An escalation that went through, which an old conversation shows as a card. */
export type Escalated = Extract<Event, { action: "escalate"; reason: null }>;

/** Whether `event` is an escalation that went through. */
export function isEscalation(event: Event): event is Escalated {
	return event.action === "escalate" && event.reason === null;
}

/**
 * What each action's event says beyond what every event does, keyed by the
 * action as `splates log` names it. An action with nothing of its own yet maps
 * to `None`: each slice of the Splates events lane fills in its command's.
 */
export interface Facts {
	add: {
		/** The branch the task starts from and merges onto. */
		base: string;
		/** The queued tasks it took, by number. */
		tasks: number[];
		/** What `--goal` said done means, or null when the tasks seed the Goal. */
		goal: string | null;
		/** The subjects of the tasks it took, in order, which seed its Goal. */
		subjects: string[];
		/** The agent it was handed to, or null when this conversation keeps it. */
		agent: string | null;
		/** That agent's model, or null for its own default or no agent. */
		model: string | null;
	};
	claim: {
		/** What its `SPLATES.md` says done means, as markdown, or "" for nothing yet. */
		goal: string;
	};
	tell: {
		/**
		 * The conversation it was said in, the agent the task was handed to. The
		 * sender is the event's own `conversation`. The page shows it as no line
		 * of its own: the receiving message says where it came from.
		 */
		to: string;
	};
	/** A wait on a task, the event's own: see `Waiting`. */
	wait: Waiting;
	merge: {
		/** Whole merge elapsed milliseconds, including waits and cleanup; absent on older events. */
		durationMs?: number;
		/** Cumulative gate milliseconds, including attribution setup and retests; absent on older events. */
		gateMs?: number;
		/** Milliseconds reserving a heavy slot and cores; absent on older events. */
		capacityWaitMs?: number;
		/** Rebase-and-retest rounds caused by trunk moving after a gate; absent on older events. */
		retests?: number;
		/** The branch it landed on, or was refused landing on. */
		base: string;
		/** The commit the base reached, short. */
		commit: string;
		/**
		 * What it touched when it landed, or the files the rebase conflicted in
		 * when refused for a conflict. Empty when a refusal names none.
		 */
		files: string[];
		/** The merge attempts it has left. */
		attemptsLeft: number;
		/**
		 * The tests the gate named as failing when refused for `tests_failed`,
		 * with what each said, so the log shows which ones fail most and why.
		 * Empty when the runner named none.
		 */
		failedTests: FailedTest[];
		/** Absent on older events or a gate that passed the first time. */
		failureAttribution?: "task" | "trunk" | "flake" | "environment";
	};
	remove: {
		/** The `--reason` it gave, or null when it gave none. */
		why: RemoveReason | null;
		/** The tasks it put back on the list, by number and subject. */
		released: { id: number; subject: string }[];
	};
	/** An escalation in an old journal, to show as its card. */
	escalate: {
		/** Why it needs the person, or for a review, what to look at. */
		about: string;
		/** Whether it asks the person to approve merging, not to answer. */
		review: boolean;
		/** Where it merges once done. */
		base: string;
		/**
		 * Its open questions under `## Blocked` as they stood, which the card
		 * asks: a report never follows the task afterwards.
		 */
		questions: Question[];
	};
	/** A task handed to another agent, as old journals hold it. */
	handoff: {
		/** The roster agent it went to, by its id. */
		agent: string;
		/** Its model, by the id the roster gives it, or null for the agent's own. */
		model: string | null;
	};
	attach: {
		/** The paths it stored, in the order given. */
		stored: string[];
		/** What `--remove` named to drop, each by path or stored name. */
		removed: string[];
	};
	"artifact add": {
		/** The artifact, by name. */
		name: string;
		/** The version it made. */
		version: number;
		/** That version's size. */
		bytes: number;
	};
	"artifact remove": {
		/** The artifact, by name. */
		name: string;
		/** The version that was current. */
		version: number;
	};
	retry: {
		/** The merge attempts the task had spent, which the grant gives it more of. */
		attempts: number;
	};
	"task add": {
		/** The task it added, by number. */
		number: number;
		/** Its line, as the page names it. */
		subject: string;
		/** The lane it went in, or null when it went in none. */
		lane: number | null;
		/** Where it went in the list, 1 at the top. */
		position: number;
		/** Whether it went in ready, groomed, rather than the backlog. */
		ready: boolean;
	};
	"task update": {
		/** The task, by number. */
		number: number;
		/** Its subject once updated, so a line names it though it was reworded. */
		subject: string;
		/** Only what moved: a key is absent when its part stayed as it was. */
		changed: {
			/** The new subject. */
			subject?: string;
			/** The new name for the task that takes it. */
			slug?: string;
			/** Whether its detail was rewritten. */
			text?: true;
			/** Where it moved to in the list, 1 at the top. */
			position?: number;
			/** The lane it moved to, null for none. */
			lane?: number | null;
			/** Tasks it is now blocked by. */
			blocked?: number[];
			/** Tasks that no longer block it. */
			unblocked?: number[];
			/** Names of the files attached. */
			attached?: string[];
			/** Names of the files dropped. */
			detached?: string[];
			/** The agent, model and thinking level it now names, null once it names none. */
			assignee?: { agent: string; model?: string; effort?: string } | null;
			/** Whether it was groomed, from the backlog to ready. */
			ready?: true;
			/** Whether only the person queues it now, a queued lane passing over it. */
			manual?: boolean;
		};
	};
	"task take": TasksFacts;
	"task wait": Waiting & {
		/** The task, by number. */
		number: number;
		/** Its subject as the wait began, or null for a task there is no such thing as. */
		subject: string | null;
	};
	"task release": TasksFacts;
	"task remove": TasksFacts;
	"queue add": TasksFacts;
	"queue remove": TasksFacts;
	"lane add": {
		/** The lane it started, by number. */
		lane: number;
		/** Its name. */
		name: string;
	};
	"lane update": {
		/** The lane, by number. */
		lane: number;
		/** Its name once updated, so a line names it though it was renamed. */
		name: string;
		/** Only what changed: a key is absent when it stayed as it was. */
		changed: {
			/** The new name. */
			name?: string;
			/** Where it moved to among the lanes, 1 the first column. */
			position?: number;
			/** Whether it runs from now on, its tasks started by `splates server`. */
			running?: boolean;
			/** Whether it is queued whole from now on, each task queued once nothing blocks it. */
			queued?: boolean;
			/** How many more tasks it may queue on its own, added to its budget. */
			approve?: number;
		};
	};
	"lane remove": {
		/** The lane, by the number it had. */
		lane: number;
		/** Its name. */
		name: string;
		/** The tasks it held, now in no lane. */
		tasks: number[];
	};
	"lane join": None;
	"creds request": {
		/** The cred asked for, as its environment variable. */
		name: string;
		/** Whether it asked, rather than finding the cred already kept. */
		asked: boolean;
	};
	"creds save": None;
	"creds remove": None;
	"creds dismiss": None;
	"creds wait": Waiting & {
		/** The cred waited for, by name. */
		name: string;
	};
	"tunnel setup": None;
	"tunnel remove": None;
	/**
	 * An agent of a `splates server` conversation reading a project note, as
	 * its tool call came: splates's own line, with no command behind it.
	 */
	"note read": {
		/** The note, by its path from the project root. */
		path: string;
		/**
		 * The note's content as the agent read it, a SHA-256 in hex, so a later
		 * reader can tell a note edited since; null when it was gone by then.
		 */
		hash: string | null;
		/** The tool call that read it, by its id. */
		tool: string;
		/** Whether a subagent read it, into its own context rather than the conversation's. */
		subagent: boolean;
		/** The note's size in bytes as the agent read it; null when it was gone by then. Absent from older events. */
		bytes?: number | null;
		/** The tokens the conversation's context held as the note was read; null when its agent said none. Absent from older events. */
		context?: number | null;
	};
	/**
	 * What the judge made of each project note for a message the person
	 * said, before its agent read it: splates's own, shown as no line, for
	 * the message's chips and the Stats page to read.
	 */
	"notes attached": {
		/** Every note judged, likeliest first, with its raw probability so tiers can be retuned. */
		notes: JudgedNote[];
		/** Whether the conversation is held back from pointers, so none was attached. */
		holdout: boolean;
		/** How long the judge took, in milliseconds. */
		ms: number;
		/**
		 * The judge's probability that the message corrects the agent: says
		 * its work or reply was wrong or not what was asked. Absent from
		 * older events.
		 */
		corrects?: number;
		/** What the judgment cost; null when the judge said no price. Absent from older events. */
		dollars?: number | null;
	};
	/**
	 * What the judge made, after a turn, of whether the agent applied a note
	 * it read in it: splates's own, shown as no line, for the Stats page's
	 * applied rate per note.
	 */
	"note applied": NoteApplied;
	/** `splates server` starting a task on what Auto pick decided, or, before it, a first prompt on what Auto picked. */
	auto: {
		/** The roster agent it picked, by its id. */
		agent: string;
		/** Its model, by the id the roster gives it, or null for the agent's own. */
		model: string | null;
		/** The thinking level it set, or null for the agent's default. */
		effort: string | null;
		/** What it picked, then why, as `AutoPickDecision.reasons`. */
		reasons: string[];
		/**
		 * What the judge found: the likeliest kind and depth, each with its
		 * confidence, or what old Auto found in the prompt; null when no judge
		 * answered, the first reason after the pick then saying why.
		 */
		signs: string[] | null;
		/**
		 * For a pick that moved the conversation up for what the person said
		 * later, what it moved off; null for one it started on, and missing
		 * from lines written before Auto pick looked again.
		 */
		lifted: Lifted | null;
	};
}

/** One note as the judge found it for a message, and what was attached of it. */
export interface JudgedNote {
	/** The note, by its path from the project root. */
	path: string;
	/** The judge's probability that it bears on what the message asks. */
	probability: number;
	/** What was attached: a directive to read it, an optional pointer, or nothing. */
	tier: "now" | "optional" | null;
	/** Read earlier in the conversation, unchanged and not compacted away since, so not attached again. */
	inContext: boolean;
	/** Read earlier, but edited since, so attached again as updated. */
	updated: boolean;
}

/** Whether a note the agent read in a turn was applied in it. */
export interface NoteApplied {
	/** The note, by its path from the project root. */
	path: string;
	/** The judge's probability that the turn's actions apply what the note says. */
	probability: number;
	/**
	 * The tier its pointer was last attached at in the conversation, or
	 * `unprompted` when the agent read it with none attached.
	 */
	tier: NonNullable<JudgedNote["tier"]> | "unprompted";
	/**
	 * This note's share of what the turn's judgment cost, split evenly over
	 * the notes it weighed; null when the judge said no price. Absent from
	 * older events.
	 */
	dollars?: number | null;
}

/** What an Auto pick that moved a conversation up moved it off. */
export interface Lifted {
	/** The pick it was on, in words: `Sonnet 5.5, low effort`. */
	from: string;
	/** Each setting it changed, by id, and what it was before, for an Undo to set back. */
	undo: Record<string, string>;
}

type None = Record<never, never>;

/**
 * A wait the page counts down: its start shows a line that runs until `until`,
 * and its end says how the wait went, pointing back at its start with `began`.
 */
export interface Waiting {
	/** When it gives up, as an ISO time. */
	until: string;
	/** The id of the event it began with, on the one it ends with; null on that first. */
	began: string | null;
}

/** The tasks a command took, released or removed, as they were named then. */
interface TasksFacts {
	tasks: { id: number; subject: string }[];
}

export type Action = keyof Facts;

/**
 * Each action's facts by name, as its event records them now: the journal
 * reads an event only when it carries all of them, and none of an action
 * missing here.
 */
// Compiles only while it lists every fact in `Facts`, so an action that
// gains one adds it here too.
export const FACTS = {
	add: ["base", "tasks", "goal", "subjects", "agent", "model"],
	claim: ["goal"],
	tell: ["to"],
	wait: ["until", "began"],
	merge: [
		"base",
		"commit",
		"files",
		"attemptsLeft",
		"failedTests",
		"failureAttribution",
		"durationMs",
		"gateMs",
		"capacityWaitMs",
		"retests",
	],
	remove: ["why", "released"],
	escalate: ["about", "review", "base", "questions"],
	handoff: ["agent", "model"],
	attach: ["stored", "removed"],
	"artifact add": ["name", "version", "bytes"],
	"artifact remove": ["name", "version"],
	retry: ["attempts"],
	"task add": ["number", "subject", "lane", "position", "ready"],
	"task update": ["number", "subject", "changed"],
	"task take": ["tasks"],
	"task wait": ["until", "began", "number", "subject"],
	"task release": ["tasks"],
	"task remove": ["tasks"],
	"queue add": ["tasks"],
	"queue remove": ["tasks"],
	"lane add": ["lane", "name"],
	"lane update": ["lane", "name", "changed"],
	"lane remove": ["lane", "name", "tasks"],
	"lane join": [],
	"creds request": ["name", "asked"],
	"creds save": [],
	"creds remove": [],
	"creds dismiss": [],
	"creds wait": ["until", "began", "name"],
	"tunnel setup": [],
	"tunnel remove": [],
	"note read": ["path", "hash", "tool", "subagent", "bytes", "context"],
	"notes attached": ["notes", "holdout", "ms", "corrects", "dollars"],
	"note applied": ["path", "probability", "tier", "dollars"],
	auto: ["agent", "model", "effort", "reasons", "signs", "lifted"],
} as const satisfies { [A in Action]: readonly (keyof Facts[A])[] };

/** Each action's facts `FACTS` leaves out, which must be none. */
type Unlisted = {
	[A in Action]: Exclude<keyof Facts[A], (typeof FACTS)[A][number]>;
}[Action];
const listed: [Unlisted] extends [never] ? true : Unlisted = true;
void listed;

/** Each todo action from before todos became tasks, and its fact naming the todo. */
const TODO_ACTIONS: Record<string, "todo" | "todos"> = {
	"todo add": "todo",
	"todo update": "todo",
	"todo wait": "todo",
	"todo take": "todos",
	"todo release": "todos",
	"todo remove": "todos",
	add: "todos",
	"lane remove": "todos",
};

/**
 * `event` as this splates names it, logged before todos became tasks: a
 * `todo ...` action as `task ...`, a todo's id as its `number`, and the todos
 * an action names as its `tasks`. A task added before tasks could be added
 * ready went in the backlog. Any other event comes back as it was.
 */
export function renamed(event: Event): Event {
	const named = asTask(event);
	return named.action === "task add" && !("ready" in named)
		? { ...named, ready: false }
		: named;
}

function asTask(event: Event): Event {
	const { action } = event as { action: string };
	const fact = TODO_ACTIONS[action];
	if (fact === undefined || !(fact in event)) {
		return event;
	}
	const { [fact]: value, ...rest } = event as unknown as Record<
		string,
		unknown
	>;
	return {
		...rest,
		action: action.replace(/^todo /, "task "),
		[fact === "todo" ? "number" : "tasks"]: value,
	} as unknown as Event;
}

/** The facts of note events that came after their first, which older events lack. */
const LATER_NOTE_FACTS: Partial<Record<Action, readonly string[]>> = {
	"note read": ["bytes", "context"],
	"notes attached": ["corrects", "dollars"],
	"note applied": ["dollars"],
};

/**
 * Whether `event` carries every fact its action records now. One that went
 * through before its action recorded them all does not, and nor does one
 * logged by a newer splates for an action this one does not know.
 */
export function isCurrent(event: Event): boolean {
	if (event.reason !== null) {
		return true;
	}
	const facts: readonly string[] | undefined = FACTS[event.action];
	return facts?.every(
		(fact) =>
			fact in event ||
			(event.action === "merge" &&
				[
					"failureAttribution",
					"durationMs",
					"gateMs",
					"capacityWaitMs",
					"retests",
				].includes(fact)) ||
			(event.action === "auto" && fact === "lifted") ||
			LATER_NOTE_FACTS[event.action]?.includes(fact) === true,
	);
}

/** What every event carries, whatever its action. */
interface Common<A extends Action> {
	/** Its own, so a reader following the log takes each event once. */
	id: string;
	at: string;
	action: A;
	/** The task it was about, or null when the command names none. */
	task: string | null;
	/** The refusal reason, or null when the command succeeded. */
	reason: string | null;
	/**
	 * The `splates server` conversation that ran it, so the page can show it there,
	 * or null for an external agent or the page itself.
	 */
	conversation: string | null;
}

/**
 * One thing that was done, and how it went. A refused command carries only
 * the facts it was asked with, since it never got to learn the rest.
 */
export type Event = {
	[A in Action]:
		| (Common<A> & { reason: null } & Facts[A])
		| (Common<A> & { reason: string } & Partial<Facts[A]>);
}[Action];

/**
 * What `ctx.journal.record` takes for an action's facts: a value, for what the
 * command was asked with, kept even when it is refused, or a function of what
 * it returned, kept only on success. An action with no facts takes none.
 */
export type FactsOf<A extends Action, T> = keyof Facts[A] extends never
	? []
	: [facts: Facts[A] | ((out: T) => Facts[A])];
