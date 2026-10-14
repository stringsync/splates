import type { Flag } from "./watch";

/** Everything the page shows of one conversation. */
export interface ConversationState {
	id: string;
	agent: string;
	/** The task whose worktree it runs in; null for the main tree. */
	task: string | null;
	/**
	 * The task it runs in, or last ran in once that task merged or went; null
	 * until it runs in one.
	 */
	lastTask: string | null;
	/**
	 * The branch `lastTask` was cut from, `task/<caller>` for a part, kept once
	 * it merges so the page still nests it under its caller; null for none.
	 */
	lastBase: string | null;
	/**
	 * The conversation whose agent added `lastTask`, kept once it merges so
	 * the page still nests it under that one; null for none.
	 */
	lastCaller: string | null;
	/** What the agent calls it, once it says. */
	title: string | null;
	/** What the person renamed it to, over the agent's title. */
	name: string | null;
	status: Status;
	/** Why it failed, for `failed`. */
	error: string | null;
	messages: Message[];
	ask: Ask | null;
	/** What the session lets the person pick: its mode, model, effort. */
	settings: Setting[];
	/** The skills and commands a message can start with, as the agent last said. */
	commands: Command[];
	createdAt: string;
	/** Put away: stopped, kept off the list, shown with the archived ones. */
	archived: boolean;
	/**
	 * Started on the agent and model a todo or `arbor add --agent` assigned,
	 * rather than ones the person picked, so a new conversation does not start
	 * where this one left its settings.
	 */
	assigned: boolean;
	/**
	 * The agent ended a turn the person has not seen yet: set as each turn
	 * ends, and cleared once the page shows it.
	 */
	unread: boolean;
	/**
	 * How many of its messages, those not queued, the person had seen when it
	 * was last marked read: an unread one opens at the one after.
	 */
	seen: number;
	/**
	 * Where the last checkpoint asked stands, kept in the log so a restart
	 * still shows it; null when none was, or once the work went on past it.
	 */
	checkpoint: Checkpoint | null;
	usage: Usage;
	/** The commands the agent left in the background, oldest first. */
	background: Background[];
}

/**
 * Where the agent is: `stopped` and `failed` have no process, and the next
 * prompt resumes the session in a new one.
 */
export type Status = "starting" | "idle" | "running" | "stopped" | "failed";

/**
 * Where a checkpoint stands: asked of the agent, done once its turn ends,
 * failed with the turn, or unanswered after `CHECKPOINT_WAIT`.
 */
export type Checkpoint = "asked" | "done" | "failed" | "unanswered";

/**
 * What follows a checkpoint: the agents stop; or `arbor dev` restarts once
 * every agent is done, and they wait to be told to carry on; or it
 * restarts and tells each to carry on itself; or it shuts down, and the next
 * start finds them waiting to be told to carry on.
 */
export type After = "stop" | "restart" | "resume" | "shutdown";

/** One turn's worth of words, the person's or the agent's. */
export interface Message {
	role: "user" | "agent";
	parts: Part[];
	/** The agent's plan, as last sent; null when it sent none. */
	plan: Step[] | null;
	/** When it began and last moved; null in a log too old to say. */
	at: string | null;
	until: string | null;
	/**
	 * Said while the agent worked, to an agent that cannot take it mid-turn:
	 * it goes out when the turn ends.
	 */
	queued?: true;
	/** When the person stopped the agent's turn, for one they stopped. */
	stopped?: string;
	/** When the connection to the agent was lost mid-turn, for one it cut short. */
	interrupted?: string;
	/** Said while the agent worked, and taken into the turn it was running. */
	steered?: true;
}

/** One piece of what someone in a conversation said or did. */
export type Part =
	/** `at` is when the agent began saying it, where the server knows. */
	| { type: "text"; text: string; at?: string | null }
	/** `at` is when the agent began it; null in a log too old to say. */
	| { type: "thought"; text: string; at: string | null }
	| ({ type: "image" } & Image)
	| ({ type: "file" } & Attached)
	| Tool;

/** An image the person sent, kept beside the conversation's log as `name`. */
export interface Image {
	name: string;
	mimeType: string;
	/**
	 * Where the page reads one still on its way, before the server keeps it;
	 * the server never sets it.
	 */
	url?: string;
}

/**
 * A file the person sent, other than an image the agent sees, kept beside
 * the conversation's log as `name`; the agent is sent a link to it.
 */
export interface Attached extends Image {
	/** What the person called it. */
	title: string;
}

/** A file the person sent, as the page sends it, before it is kept. */
export interface Upload {
	/** What the person called it. */
	title: string;
	mimeType: string;
	bytes: Uint8Array;
}

/** What the person sent with their words, as their message holds it. */
export type Sent = Extract<Part, { type: "image" | "file" }>;

/** A tool call the agent made, as much of it as the page shows. */
export interface Tool {
	type: "tool";
	id: string;
	title: string;
	status: "pending" | "in_progress" | "completed" | "failed";
	/** What ACP says it does: read, edit, execute, search, think, and so on. */
	kind: string | null;
	/** The command it runs, for one that runs one. */
	command: string | null;
	/** What it searches for or fetches, as its input names it: a pattern, a query or a URL. */
	target: string | null;
	/** The end of what it printed, at most `TOOL_CHARS`. */
	output: string;
	/** The changes it made to files. */
	edits: Edit[];
	/** The files it touched. */
	paths: string[];
	/** The subagent's tool call it was made under, if one made it. */
	parent: string | null;
	/** When it began and finished; null in a log too old to say, or until it has. */
	at: string | null;
	until: string | null;
	/** What a command did to git that it should not have. */
	flags: Flag[];
	/** How the person answered the agent asking to make it; null when it never asked. */
	decision: Decision | null;
}

/**
 * A command the agent left running in the background, as Claude's Bash with
 * `run_in_background`, kept once it ends until the agent's process does.
 */
export interface Background {
	/** The agent's id for it, which stopping it names. */
	id: string;
	/** What the agent said it is for. */
	name: string;
	/** The command it runs, from the tool call that started it; null when unknown. */
	command: string | null;
	/**
	 * The subagent whose call started it, by that subagent's tool call; null
	 * for one the agent started itself, or when the call is unknown.
	 */
	subagent: { id: string; title: string } | null;
	state: BackgroundState;
	/** The file the agent writes what it prints to; null until it says. */
	output: string | null;
}

export type BackgroundState = "running" | "completed" | "failed" | "stopped";

/** How the person answered an agent asking permission for a tool call. */
export interface Decision {
	/** The option they picked; null for an ask dismissed, as by stopping the turn. */
	option: { name: string; kind: string } | null;
	at: string;
}

/** A change to one file: `old` is null for a file the edit created. */
export interface Edit {
	path: string;
	old: string | null;
	new: string;
}

/** A step of the agent's plan for the turn. */
export interface Step {
	text: string;
	status: "pending" | "in_progress" | "completed";
}

/** A field of a question an agent asks, answered with one of `choices` or in words. */
export interface Field {
	key: string;
	title: string;
	description: string | null;
	/** Absent for a field answered in words. */
	choices:
		| { value: string; title: string; description: string | null }[]
		| null;
}

/** What the agent is waiting on the person for, since `at`. */
export type Ask = Asked & { at: string };

/** What the agent asks, before it is stamped with when. */
export type Asked =
	| {
			type: "permission";
			id: string;
			title: string;
			options: { id: string; name: string; kind: string }[];
	  }
	| { type: "question"; id: string; message: string; fields: Field[] };

/** How an `Ask` was answered. */
export type Answer =
	| { type: "permission"; option: string }
	| { type: "question"; values: Record<string, string> }
	| { type: "dismiss" };

/** A choice the agent offers for the session, like its model. */
export interface Setting {
	id: string;
	name: string;
	/**
	 * A pick among its options, or an on/off toggle, like fast mode, whose
	 * options are `on` and `off`.
	 */
	type: "select" | "boolean";
	/** What it sets, as ACP names it: mode, model, thought_level, or its own. */
	category: string | null;
	current: string;
	options: { value: string; name: string; description: string | null }[];
}

/** A command the agent runs when a message starts with `/` and its name. */
export interface Command {
	name: string;
	description: string;
	/** What to write after its name, for one that takes input. */
	hint: string | null;
}

/** What a session has used, as far as its agent says. */
export interface Usage {
	/** Tokens in the context window, of the most it holds; null until said. */
	context: { used: number; size: number } | null;
	/** Tokens read over every turn the agent counted, those from cache among them. */
	input: number;
	/** Of `input`, those read from cache. */
	cached: number;
	/** Tokens written over every turn the agent counted. */
	output: number;
	/**
	 * What the session cost, over every process it ran in; null for an agent
	 * that never says, as Codex does not.
	 */
	cost: {
		amount: number;
		currency: string;
		/**
		 * What the agent last said it had cost: Claude counts from naught in
		 * each new process, so a figure below it starts a new count.
		 */
		said: number;
	} | null;
	/** The plan's windows of use, as the agent last said; none from Codex. */
	limits: Limit[];
}

/**
 * One window of the plan's use, as Claude says with each reply: the account's,
 * not the session's, so every conversation with the agent shares it.
 */
export interface Limit {
	/** As Claude names it: `five_hour`, `seven_day`, `seven_day_opus`. */
	window: string;
	/** How much of it is used, from 0 to 1. */
	used: number;
	/** When it starts over, as an ISO timestamp. */
	resets: string;
	/** When the agent said so; null in logs written before it was kept. */
	at: string | null;
}

/** What a session has used before its agent says anything of it. */
export function unused(): Usage {
	return {
		context: null,
		input: 0,
		cached: 0,
		output: 0,
		cost: null,
		limits: [],
	};
}

/** A conversation as it starts, before its agent has said anything. */
export function blank(
	id: string,
	agent: string,
	task: string | null,
	createdAt: string,
	base: string | null = null,
	caller: string | null = null,
	assigned = false,
): ConversationState {
	return {
		id,
		agent,
		task,
		lastTask: task,
		lastBase: task === null ? null : base,
		lastCaller: task === null ? null : caller,
		title: null,
		name: null,
		status: "starting",
		error: null,
		messages: [],
		ask: null,
		settings: [],
		commands: [],
		createdAt,
		archived: false,
		assigned,
		unread: false,
		seen: 0,
		checkpoint: null,
		usage: unused(),
		background: [],
	};
}
