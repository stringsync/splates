import type { Question } from "../plans";
import type { FailedTest, RemoveReason } from "../tasks";

/** An escalation that went through, which asks the person to act. */
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
		/** Whether the task was escalated, so the claim ends a wait on the user. */
		escalated: boolean;
		/**
		 * Whether the agent claiming is the one the task was handed to with
		 * `splates handoff`, taking it over.
		 */
		tookOver: boolean;
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
	};
	remove: {
		/** The `--reason` it gave, or null when it gave none. */
		why: RemoveReason | null;
		/** The tasks it put back on the list, by number and subject. */
		released: { id: number; subject: string }[];
	};
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
	/** `splates server` starting a conversation on what Auto picked for its first prompt. */
	auto: {
		/** The roster agent it picked, by its id. */
		agent: string;
		/** Its model, by the id the roster gives it, or null for the agent's own. */
		model: string | null;
		/** The thinking level it set, or null for the agent's default. */
		effort: string | null;
		/** What it picked, then why, as `AutoPick.reasons`. */
		reasons: string[];
		/** What the judge found in the prompt, as `AutoPick.signs`; null when no judge answered. */
		signs: string[] | null;
	};
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
	claim: ["escalated", "tookOver", "goal"],
	tell: ["to"],
	wait: ["until", "began"],
	merge: ["base", "commit", "files", "attemptsLeft", "failedTests"],
	remove: ["why", "released"],
	escalate: ["about", "review", "base", "questions"],
	handoff: ["agent", "model"],
	attach: ["stored", "removed"],
	"artifact add": ["name", "version", "bytes"],
	"artifact remove": ["name", "version"],
	retry: ["attempts"],
	"task add": ["number", "subject", "lane", "position"],
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
	auto: ["agent", "model", "effort", "reasons", "signs"],
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
 * an action names as its `tasks`. Any other event comes back as it was.
 */
export function renamed(event: Event): Event {
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
	return facts?.every((fact) => fact in event);
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
