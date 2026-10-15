import type { RemoveReason } from "./worktree";

/**
 * What each action's event says beyond what every event does, keyed by the
 * action as `arbor log` names it. An action with nothing of its own yet maps
 * to `None`: each slice of the Arbor events lane fills in its command's.
 */
export interface Facts {
	add: {
		/** The branch the task starts from and merges onto. */
		base: string;
		/** The todos it took, by id. */
		todos: number[];
		/** What `--goal` said done means, or null when the todos seed the Goal. */
		goal: string | null;
		/** The subjects of the todos it took, in order, which seed its Goal. */
		subjects: string[];
		/** The agent it was handed to, or null when this conversation keeps it. */
		agent: string | null;
		/** That agent's model, or null for its own default or no agent. */
		model: string | null;
	};
	claim: {
		/** Whether the task was escalated, so the claim ends a wait on the user. */
		escalated: boolean;
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
	merge: None;
	remove: {
		/** The `--reason` it gave, or null when it gave none. */
		why: RemoveReason | null;
		/** The todos it put back on the list, by id and subject. */
		released: { id: number; subject: string }[];
	};
	escalate: None;
	handoff: None;
	attach: None;
	retry: None;
	"todo add": {
		/** The todo it added, by id. */
		todo: number;
		/** Its line, as the page names it. */
		subject: string;
		/** The lane it went in, or null when it went in none. */
		lane: number | null;
		/** Where it went in the list, 1 at the top. */
		position: number;
	};
	"todo update": {
		/** The todo, by id. */
		todo: number;
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
			/** Todos it is now blocked by. */
			blocked?: number[];
			/** Todos that no longer block it. */
			unblocked?: number[];
			/** Names of the files attached. */
			attached?: string[];
			/** Names of the files dropped. */
			detached?: string[];
			/** The agent and model it now names, null once it names none. */
			assignee?: { agent: string; model?: string } | null;
		};
	};
	"todo take": None;
	"todo wait": Waiting & {
		/** The todo, by id. */
		todo: number;
		/** Its subject as the wait began, or null for a todo there is no such thing as. */
		subject: string | null;
	};
	"todo release": None;
	"todo remove": None;
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
		};
	};
	"lane remove": {
		/** The lane, by the number it had. */
		lane: number;
		/** Its name. */
		name: string;
		/** The todos it held, now in no lane. */
		todos: number[];
	};
	"lane join": None;
	"creds request": None;
	"creds save": None;
	"creds remove": None;
	"creds dismiss": None;
	"creds wait": Waiting & {
		/** The cred waited for, by name. */
		name: string;
	};
	"tunnel setup": None;
	"tunnel remove": None;
}

type None = Record<never, never>;

/**
 * A wait, logged twice in the append-only journal: as it begins, so the page
 * can count down to `until` while it runs, then as it ends, saying how, with
 * `began` naming the first. The page folds the two into one line.
 */
export interface Waiting {
	/** When it gives up, as an ISO time. */
	until: string;
	/** The id of the event it began with, on the one it ends with; null on that first. */
	began: string | null;
}

export type Action = keyof Facts;

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
	 * The `arbor dev` conversation that ran it, so the page can show it there,
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
 * An action's facts: what it was asked with, known before it runs and kept
 * when it is refused, or a function of what it returned, kept only when it
 * succeeds. An action with no facts of its own takes none.
 */
export type FactsOf<A extends Action, T> = keyof Facts[A] extends never
	? []
	: [facts: Facts[A] | ((out: T) => Facts[A])];
