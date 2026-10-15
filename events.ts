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
		/** The agent it was handed to, or null when this conversation keeps it. */
		agent: string | null;
		/** That agent's model, or null for its own default or no agent. */
		model: string | null;
	};
	claim: {
		/** Whether the task was escalated, so the claim ends a wait on the user. */
		escalated: boolean;
	};
	merge: None;
	remove: None;
	escalate: None;
	handoff: None;
	attach: None;
	retry: None;
	"todo add": None;
	"todo update": None;
	"todo take": None;
	"todo release": None;
	"todo remove": None;
	"lane add": None;
	"lane update": None;
	"lane remove": None;
	"lane join": None;
	"creds request": None;
	"creds save": None;
	"creds remove": None;
	"creds dismiss": None;
	"tunnel setup": None;
	"tunnel remove": None;
}

type None = Record<never, never>;

export type Action = keyof Facts;

/** What every event carries, whatever its action. */
interface Common<A extends Action> {
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
