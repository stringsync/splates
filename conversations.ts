import { createHash } from "node:crypto";
import * as acp from "@agentclientprotocol/sdk";
import type { Resource } from "webappwiz/disposable";
import { Dispatcher, type Eventful } from "webappwiz/events";
import { type IdProvider, UuidProvider } from "webappwiz/id";
import { type Fs, NodeFs, NodePs } from "webappwiz/system";
import {
	Duration,
	SystemTimer,
	SystemWallClock,
	Throttler,
	type Timer,
	type WallClock,
} from "webappwiz/time";
import { fail } from "./exit";
import { modelOption } from "./models";
import type { Offered } from "./offered";
import { CHECKPOINT } from "./prompts";
import { SERVING } from "./supervise";
import type { Flag, Watch, Watched } from "./watch";

/** An agent arbor can hold a conversation with over ACP, and how to start it. */
export interface Agent {
	id: string;
	name: string;
	argv: string[];
}

/** A running agent: bytes in, bytes out, and a way to stop it. */
export interface AgentProcess {
	/** Its pid, for what runs under it; null for one that never started. */
	pid: number | null;
	input: WritableStream<Uint8Array>;
	output: ReadableStream<Uint8Array>;
	/** What it last wrote to stderr, for when it dies before saying why. */
	stderr(): string;
	exited: Promise<number>;
	kill(): void;
}

/** Starts `argv` in `cwd`, with `env` added to its own, its stdio piped. */
export type Launch = (
	argv: string[],
	cwd: string,
	env: Record<string, string>,
) => AgentProcess;

export const launch: Launch = (argv, cwd, env) => {
	// So an `arbor dev` the agent runs supervises itself rather than serving
	// as this one's child.
	const child = new NodePs().start(argv, { cwd, env, unset: [SERVING] });
	let tail = "";
	// One that never started, as in a directory since removed, aborts its
	// pipes and rejects its exit: it ends as one that exited saying why.
	void (async () => {
		const decoder = new TextDecoder();
		for await (const chunk of child.stderr) {
			tail = (tail + decoder.decode(chunk)).slice(-STDERR_CHARS);
		}
	})().catch(() => {});
	return {
		pid: child.pid,
		input: child.stdin,
		output: child.stdout,
		stderr: () => tail,
		exited: child.exited.catch((error: unknown) => {
			tail = `cannot start ${argv[0]} in ${cwd}: ${error instanceof Error ? error.message : String(error)}`;
			return 127;
		}),
		kill: () => child.kill(),
	};
};

/** How much of an agent's stderr is kept to explain how it died. */
const STDERR_CHARS = 2_000;

/** How much of a tool call's output, and of each side of an edit, is kept. */
const TOOL_CHARS = 20_000;

/** One piece of what someone in a conversation said or did. */
export type Part =
	| { type: "text"; text: string }
	/** `at` is when the agent began it; null in a log too old to say. */
	| { type: "thought"; text: string; at: string | null }
	| ({ type: "image" } & Image)
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

/** An image as the page sends it, before it is kept. */
export interface Upload {
	mimeType: string;
	/** Its bytes, in base64. */
	data: string;
}

/** The images an agent can be sent, by media type, with the extension each is kept under. */
const IMAGE_TYPES: Record<string, string> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/gif": "gif",
	"image/webp": "webp",
};

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
type Asked =
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

/**
 * Where the agent is: `stopped` and `failed` have no process, and the next
 * prompt resumes the session in a new one.
 */
export type Status = "starting" | "idle" | "running" | "stopped" | "failed";

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
}

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
}

/** A line of a conversation's log: what was said, in the order it was. */
type Entry =
	| {
			kind: "start";
			id: string;
			agent: string;
			task: string | null;
			/** Where it runs; missing from logs written before resuming. */
			cwd?: string;
			/** The task's base; missing from logs written before parts nested. */
			base?: string | null;
			createdAt: string;
	  }
	| { kind: "session"; session: string }
	/** Moved into a task's worktree, or back to the main tree. */
	| {
			kind: "task";
			task: string | null;
			cwd: string;
			/** The task's base; missing from logs written before parts nested. */
			base?: string | null;
	  }
	/** What the session offered and had set, kept so the next one can start alike. */
	| { kind: "settings"; settings: Setting[] }
	/** `at` is missing from logs written before older archived ones were deleted. */
	| { kind: "archive"; archived: boolean; at?: string }
	| { kind: "rename"; name: string | null }
	| { kind: "unread"; unread: boolean }
	/** `at` is missing from logs written before the page showed how long things took. */
	| {
			kind: "prompt";
			text: string;
			at?: string;
			queued?: true;
			/** Missing from logs written before the page sent images. */
			images?: Image[];
	  }
	/** Every queued prompt went out. */
	| { kind: "sent" }
	/** The person stopped the agent's turn. */
	| { kind: "stopped"; at: string }
	/** The `index`th queued prompt was taken back. */
	| { kind: "unqueue"; index: number }
	/** Where a checkpoint stands, and what comes after it. */
	| { kind: "checkpoint"; checkpoint: Checkpoint | null }
	| { kind: "update"; update: acp.SessionUpdate; at?: string }
	/** The tokens a turn used, as the agent said when it ended. */
	| { kind: "usage"; usage: acp.Usage }
	/** What a finished command did to git that it should not have. */
	| { kind: "flags"; tool: string; flags: Flag[] }
	/** How the person answered the agent asking permission for a tool call. */
	| { kind: "decision"; tool: string; decision: Decision }
	| { kind: "end"; error: string | null };

/**
 * Folds one ACP update, sent `at`, into the messages: text runs on in the
 * message it started, and a tool call is one part that fills in as it runs.
 */
export function fold(
	state: ConversationState,
	update: acp.SessionUpdate,
	at: string | null = null,
): void {
	switch (update.sessionUpdate) {
		case "agent_message_chunk":
		case "agent_thought_chunk": {
			// A subagent's words are its own, kept in the log but out of the
			// conversation's: its tool call stands for it.
			if (update.content.type !== "text" || parentOf(update) !== null) {
				return;
			}
			const turn = agentTurn(state, at);
			const last = turn.parts.at(-1);
			if (update.sessionUpdate === "agent_message_chunk") {
				if (last?.type === "text") {
					last.text += update.content.text;
				} else {
					turn.parts.push({ type: "text", text: update.content.text });
				}
			} else if (last?.type === "thought") {
				last.text += update.content.text;
			} else {
				turn.parts.push({ type: "thought", text: update.content.text, at });
			}
			return;
		}
		case "tool_call": {
			// Already made, when asking permission for it came first.
			const made = toolIn(state, update.toolCallId);
			if (made !== null) {
				fill(made, update, at);
				return;
			}
			const tool: Tool = {
				type: "tool",
				id: update.toolCallId,
				title: update.title,
				status: "pending",
				kind: update.kind ?? null,
				command: null,
				target: null,
				output: "",
				edits: [],
				paths: [],
				parent: parentOf(update),
				at,
				until: null,
				flags: [],
				decision: null,
			};
			agentTurn(state, at).parts.push(tool);
			fill(tool, update, at);
			return;
		}
		case "tool_call_update": {
			const part = toolIn(state, update.toolCallId);
			if (part !== null) {
				fill(part, update, at);
				moved(state, at);
			}
			return;
		}
		case "plan":
			agentTurn(state, at).plan = update.entries.map((entry) => ({
				text: entry.content,
				status: entry.status,
			}));
			return;
		case "session_info_update":
			if (update.title !== undefined) {
				state.title = update.title;
			}
			return;
		case "config_option_update":
			state.settings = settingsIn(update.configOptions);
			return;
		case "available_commands_update":
			state.commands = update.availableCommands.map((command) => ({
				name: command.name,
				description: command.description,
				hint: command.input?.hint ?? null,
			}));
			return;
		case "usage_update":
			// A subagent's context is its own.
			if (parentOf(update) !== null) {
				return;
			}
			state.usage.context = { used: update.used, size: update.size };
			if (update.cost != null) {
				const { amount, currency } = update.cost;
				const before = state.usage.cost;
				const carried =
					before === null
						? 0
						: before.amount - (amount < before.said ? 0 : before.said);
				state.usage.cost = { amount: carried + amount, currency, said: amount };
			}
			return;
		case "current_mode_update":
			state.settings = state.settings.map((setting) =>
				setting.category === "mode"
					? { ...setting, current: update.currentModeId }
					: setting,
			);
			return;
		default:
			return;
	}
}

/** Adds the tokens a turn used to those of the turns before it. */
function tally(state: ConversationState, usage: acp.Usage): void {
	const cached = usage.cachedReadTokens ?? 0;
	state.usage.input +=
		usage.inputTokens + cached + (usage.cachedWriteTokens ?? 0);
	state.usage.cached += cached;
	state.usage.output += usage.outputTokens;
}

/**
 * The agent's message at the end, started if the person spoke last, marked
 * as having moved `at`. Queued messages stay below it: the agent has yet to
 * hear them, so nothing it says meanwhile answers them.
 */
function agentTurn(state: ConversationState, at: string | null): Message {
	const { messages } = state;
	let end = messages.length;
	while (messages[end - 1]?.queued) {
		end--;
	}
	const last = messages[end - 1];
	if (last?.role === "agent") {
		last.until = at ?? last.until;
		return last;
	}
	const turn: Message = {
		role: "agent",
		parts: [],
		plan: null,
		at,
		until: at,
	};
	messages.splice(end, 0, turn);
	return turn;
}

/** The tool call `id`, wherever in the conversation it was made. */
function toolIn(state: ConversationState, id: string): Tool | null {
	for (const message of state.messages) {
		for (const part of message.parts) {
			if (part.type === "tool" && part.id === id) {
				return part;
			}
		}
	}
	return null;
}

/** Marks the agent's message at the end, if it is the last, as having moved `at`. */
function moved(state: ConversationState, at: string | null): void {
	const last = state.messages.at(-1);
	if (last?.role === "agent" && at !== null) {
		last.until = at;
	}
}

/** Whether `update` is the agent at work, as it is only in a turn. */
function starts(update: acp.SessionUpdate): boolean {
	return (
		(update.sessionUpdate === "agent_message_chunk" ||
			update.sessionUpdate === "agent_thought_chunk" ||
			update.sessionUpdate === "tool_call") &&
		parentOf(update) === null
	);
}

/**
 * Whether `update` ends a turn: Claude says where each turn came from in the
 * usage it sends at the turn's end, and only then.
 */
function result(update: acp.SessionUpdate): boolean {
	return (
		update.sessionUpdate === "usage_update" &&
		update._meta?.["_claude/origin"] != null
	);
}

/** The subagent's tool call an update came from: Claude stamps it in `_meta`. */
function parentOf(update: {
	_meta?: { [key: string]: unknown } | null;
}): string | null {
	const claude = update._meta?.claudeCode as
		| { parentToolUseId?: unknown }
		| undefined;
	return typeof claude?.parentToolUseId === "string"
		? claude.parentToolUseId
		: null;
}

/**
 * Takes what an update says of a tool call into it. Adapters say it in
 * different places: Claude sends a command's output whole as `rawOutput`
 * once it ends, Codex streams it in `_meta` and says how it exited there.
 */
function fill(
	tool: Tool,
	update: acp.ToolCall | acp.ToolCallUpdate,
	at: string | null,
): void {
	tool.title = update.title ?? tool.title;
	tool.kind = update.kind ?? tool.kind;
	const input = update.rawInput as
		| { command?: unknown; pattern?: unknown; query?: unknown; url?: unknown }
		| null
		| undefined;
	if (typeof input?.command === "string") {
		tool.command = input.command;
	} else if (Array.isArray(input?.command)) {
		tool.command = input.command.join(" ");
	}
	const target = input?.pattern ?? input?.query ?? input?.url;
	if (typeof target === "string") {
		tool.target = target;
	}
	if (update.locations != null && update.locations.length > 0) {
		tool.paths = [...new Set(update.locations.map((each) => each.path))];
	}
	const edits = (update.content ?? []).flatMap((each): Edit[] =>
		each.type === "diff"
			? [
					{
						path: each.path,
						old:
							each.oldText == null ? null : each.oldText.slice(0, TOOL_CHARS),
						new: each.newText.slice(0, TOOL_CHARS),
					},
				]
			: [],
	);
	if (edits.length > 0) {
		tool.edits = edits;
		tool.paths = [
			...new Set([...tool.paths, ...edits.map((each) => each.path)]),
		];
	}
	const meta = update._meta as
		| {
				terminal_output_delta?: { data?: unknown };
				terminal_exit?: { exit_code?: unknown };
		  }
		| null
		| undefined;
	const delta = meta?.terminal_output_delta?.data;
	if (typeof delta === "string") {
		tool.output = (tool.output + delta).slice(-TOOL_CHARS);
	}
	const ended = update.status === "completed" || update.status === "failed";
	if (typeof update.rawOutput === "string") {
		tool.output = update.rawOutput.slice(-TOOL_CHARS);
	} else if (ended && tool.output === "") {
		// Until it ends, Claude's content is what the command is for, not what
		// it printed.
		tool.output = (update.content ?? [])
			.flatMap((each) =>
				each.type === "content" && each.content.type === "text"
					? [unfenced(each.content.text)]
					: [],
			)
			.join("\n")
			.slice(-TOOL_CHARS);
	}
	const code = meta?.terminal_exit?.exit_code;
	tool.status =
		typeof code === "number" && code !== 0
			? "failed"
			: (update.status ?? tool.status);
	if (ended) {
		tool.until = at;
	}
}

/** `text` without the code fence an adapter wrapped a command's output in. */
function unfenced(text: string): string {
	const fenced = /^```[^\n]*\n([\s\S]*?)\n?```$/.exec(text.trim());
	return fenced?.[1] ?? text;
}

/** The session's settings the agent lets the person pick from, in its order. */
function settingsIn(
	options: acp.SessionConfigOption[] | null | undefined,
): Setting[] {
	return (options ?? []).flatMap((option): Setting[] => {
		if (option.type === "boolean") {
			return [
				{
					id: option.id,
					name: option.name,
					type: "boolean",
					category: option.category ?? null,
					current: option.currentValue ? "on" : "off",
					options: [
						{ value: "on", name: "On", description: null },
						{ value: "off", name: "Off", description: null },
					],
				},
			];
		}
		if (option.type !== "select") {
			return [];
		}
		const flat = option.options.flatMap((each) =>
			"group" in each ? each.options : [each],
		);
		return [
			{
				id: option.id,
				name: option.name,
				type: "select",
				category: option.category ?? null,
				current: option.currentValue,
				options: flat.map((each) => ({
					value: each.value,
					name: each.name,
					description: each.description ?? null,
				})),
			},
		];
	});
}

/** `value` for `setting` as ACP sets it: a toggle's as a boolean. */
function configValue(
	setting: Setting,
	value: string,
): { type: "boolean"; value: boolean } | { value: string } {
	return setting.type === "boolean"
		? { type: "boolean", value: value === "on" }
		: { value };
}

/** A form an agent asks with, as the fields the page shows. */
function fieldsIn(schema: unknown): Field[] {
	const properties =
		typeof schema === "object" && schema !== null && "properties" in schema
			? (schema.properties as Record<string, Record<string, unknown>>)
			: {};
	return Object.entries(properties).map(([key, property]) => {
		const oneOf = property.oneOf as
			| { const: string; title?: string; description?: string }[]
			| undefined;
		const enums = property.enum as string[] | undefined;
		const choices =
			oneOf?.map((choice) => ({
				value: String(choice.const),
				title: choice.title ?? String(choice.const),
				description: choice.description ?? null,
			})) ??
			enums?.map((value) => ({ value, title: value, description: null })) ??
			null;
		return {
			key,
			title: String(property.title ?? key),
			description:
				typeof property.description === "string" ? property.description : null,
			choices,
		};
	});
}

export type ConversationEvents = { changed: undefined };

/** How often a live conversation's log is saved while the agent streams. */
const SAVE_EVERY = Duration.ms(500);

/** How long an agent has to answer a checkpoint before it is unanswered. */
const CHECKPOINT_WAIT = Duration.mins(2);

/**
 * Where a checkpoint stands: asked of the agent, done once its turn ends,
 * failed with the turn, or unanswered after `CHECKPOINT_WAIT`.
 */
export type Checkpoint = "asked" | "done" | "failed" | "unanswered";

/**
 * What follows a checkpoint: the agents stop; or `arbor dev` restarts once
 * every agent is done, and they wait to be told to carry on; or it
 * restarts and tells each to carry on itself.
 */
export type After = "stop" | "restart" | "resume";

/**
 * One conversation with one agent. Live, it holds the agent's process; read
 * back from its log, it is what was said, and resumes on the next prompt.
 */
export class Conversation implements Eventful<ConversationEvents>, Resource {
	private readonly dispatcher = new Dispatcher<ConversationEvents>();
	readonly events = this.dispatcher.events;

	private connection: acp.ClientSideConnection | null = null;
	private process: AgentProcess | null = null;
	private session: string | null = null;
	/** Settles the agent's pending ask with the person's answer. */
	private settle: ((answer: Answer) => void) | null = null;
	/** Whether the agent takes a prompt into its running turn. */
	private steers = false;
	/** Whether the agent takes images in a prompt. */
	private sees = false;
	/** Whether the person cancelled the last turn, which holds the queue. */
	private held = false;
	/** Whether the turn running is one the agent started, with no prompt to end it. */
	private unprompted = false;
	/** Whether the agent has said a turn ended, as Claude does, so one it starts can end. */
	private tells = false;
	/** The log's lines not yet appended to it. */
	private readonly unsaved: string[] = [];
	private saving: Promise<void> = Promise.resolve();
	private readonly saves: Throttler;
	/** Under way while the agent starts or comes back, for a prompt to wait on. */
	private opening: Promise<void> | null = null;
	/** Settings picked before the session opened, set once it has. */
	private picks: Record<string, string> = {};
	/** The model asked for before the session opened, picked once it has. */
	private model: string | null = null;
	/** Gives up on an asked checkpoint once `CHECKPOINT_WAIT` is out. */
	private waiting: Resource | null = null;
	/** Whether a checkpoint is cancelling the turn, whose end is not its own. */
	private interrupting = false;
	/** The commands running, by tool call, each watched since it started. */
	private readonly watching = new Map<string, Watched>();
	/** Whether the next open loads the session, replaying it, rather than resuming it. */
	private loading = false;
	/** The person's words the replay has said so far, not yet logged as a prompt. */
	private heard: string | null = null;
	/** When it was archived, for which archived ones to keep; null when unknown or not archived. */
	private archivedAt: string | null = null;

	private constructor(
		readonly state: ConversationState,
		private readonly log: string,
		private readonly fs: Fs,
		private readonly timer: Timer,
		private readonly clock: WallClock,
		/** What to run to resume it; null when its agent is no longer known. */
		private readonly agent: Agent | null,
		/** Where it runs; null for a log too old to say. */
		private cwd: string | null,
		private readonly run: Launch,
		/** Where `arbor dev` answers, for the agent's CLI to tell it things. */
		private readonly url: string | null,
		/** What watches the agent's commands; null to leave them be. */
		private readonly watch: Watch | null,
		/** The main tree, where it carries on once its worktree is gone. */
		private readonly root: string | null,
	) {
		this.saves = new Throttler(timer, SAVE_EVERY);
	}

	get id(): string {
		return this.state.id;
	}

	/** The agent's pid while it runs, for the commands it left running. */
	get pid(): number | null {
		return this.process?.pid ?? null;
	}

	/** The agent's session, once it has opened one. */
	get sessionId(): string | null {
		return this.session;
	}

	/**
	 * When it was archived, or when it started for a log too old to say; null
	 * while it is not archived.
	 */
	get archivedSince(): string | null {
		return this.state.archived
			? (this.archivedAt ?? this.state.createdAt)
			: null;
	}

	private now(): string {
		return new Date(this.clock.now()).toISOString();
	}

	/** A conversation as its log left it: stopped, whatever it was doing. */
	static async read(
		log: string,
		{
			fs,
			timer,
			clock,
			agents,
			launch: run,
			url,
			watch = null,
			root = null,
		}: {
			fs: Fs;
			timer: Timer;
			clock: WallClock;
			agents: Agent[];
			launch: Launch;
			url: string | null;
			watch?: Watch | null;
			root?: string | null;
		},
	): Promise<Conversation | null> {
		const text = await fs.read(log);
		const lines = text.split("\n").filter(Boolean);
		const entries = lines.flatMap((line) => {
			try {
				return [JSON.parse(line) as Entry];
			} catch {
				return [];
			}
		});
		const start = entries[0];
		if (start?.kind !== "start") {
			return null;
		}
		const conversation = new Conversation(
			blank(start.id, start.agent, start.task, start.createdAt, start.base),
			log,
			fs,
			timer,
			clock,
			agents.find((each) => each.id === start.agent) ?? null,
			start.cwd ?? null,
			run,
			url,
			watch,
			root,
		);
		// A line cut short, as by a crash mid-save, stays apart from the next.
		if (text !== "" && !text.endsWith("\n")) {
			conversation.unsaved.push("\n");
		}
		const { state } = conversation;
		for (const entry of entries) {
			if (entry.kind === "prompt") {
				state.messages.push({
					...said(entry.text, entry.at ?? null, entry.images),
					...(entry.queued ? { queued: true } : {}),
				});
			} else if (entry.kind === "sent") {
				delivered(state.messages);
			} else if (entry.kind === "stopped") {
				agentTurn(state, entry.at).stopped = entry.at;
			} else if (entry.kind === "unqueue") {
				takeBack(state.messages, entry.index);
			} else if (entry.kind === "update") {
				fold(state, entry.update, entry.at ?? null);
			} else if (entry.kind === "usage") {
				tally(state, entry.usage);
			} else if (entry.kind === "session") {
				conversation.session = entry.session;
			} else if (entry.kind === "task") {
				state.task = entry.task;
				state.lastTask = entry.task ?? state.lastTask;
				state.lastBase =
					entry.task === null ? state.lastBase : (entry.base ?? null);
				conversation.cwd = entry.cwd;
			} else if (entry.kind === "settings") {
				state.settings = entry.settings;
			} else if (entry.kind === "archive") {
				state.archived = entry.archived;
				conversation.archivedAt = entry.archived ? (entry.at ?? null) : null;
			} else if (entry.kind === "rename") {
				state.name = entry.name;
			} else if (entry.kind === "unread") {
				state.unread = entry.unread;
				if (!entry.unread) {
					state.seen = sent(state.messages);
				}
			} else if (entry.kind === "checkpoint") {
				state.checkpoint = entry.checkpoint;
			} else if (entry.kind === "flags") {
				const tool = toolIn(state, entry.tool);
				if (tool !== null) {
					tool.flags = entry.flags;
				}
			} else if (entry.kind === "decision") {
				const tool = toolIn(state, entry.tool);
				if (tool !== null) {
					tool.decision = entry.decision;
				}
			} else if (entry.kind === "end") {
				state.error = entry.error;
			}
		}
		state.status = state.error === null ? "stopped" : "failed";
		// Its process ended before the agent answered.
		if (state.checkpoint === "asked") {
			state.checkpoint = "unanswered";
		}
		// As last set, for the resumed session to match, picks made while
		// stopped among them.
		conversation.picks = Object.fromEntries(
			state.settings.map((each) => [each.id, each.current]),
		);
		return conversation;
	}

	/** Starts `agent` in `cwd` and opens a session with it. */
	static async start(
		{
			id,
			agent,
			task,
			base = null,
			cwd,
			log,
			settings = {},
			model,
		}: {
			id: string;
			agent: Agent;
			task: string | null;
			/** The branch `task` was cut from. */
			base?: string | null;
			cwd: string;
			log: string;
			/** Values to set, by setting id, once the session offers them. */
			settings?: Record<string, string>;
			/**
			 * The model to pick, by its value or name in the session's model
			 * setting, over what `settings` says; the agent's own when it offers
			 * none such.
			 */
			model?: string;
		},
		{
			fs,
			timer,
			clock,
			launch: run,
			url,
			watch = null,
			root = null,
		}: {
			fs: Fs;
			timer: Timer;
			clock: WallClock;
			launch: Launch;
			url: string | null;
			watch?: Watch | null;
			root?: string | null;
		},
	): Promise<Conversation> {
		const conversation = new Conversation(
			blank(id, agent.id, task, new Date(clock.now()).toISOString(), base),
			log,
			fs,
			timer,
			clock,
			agent,
			cwd,
			run,
			url,
			watch,
			root,
		);
		conversation.write({
			kind: "start",
			id,
			agent: agent.id,
			task,
			cwd,
			base,
			createdAt: conversation.state.createdAt,
		});
		conversation.picks = settings;
		conversation.model = model ?? null;
		conversation.opening = conversation.open(agent, cwd).finally(() => {
			conversation.opening = null;
		});
		return conversation;
	}

	/**
	 * Brings in `session`, one `agent` holds outside arbor, such as from its
	 * CLI: loads it in `cwd`, writing what the agent replays of it to a new
	 * log, from which it resumes like any other.
	 */
	static async bring(
		{
			id,
			agent,
			session,
			title,
			task,
			base = null,
			cwd,
			log,
		}: {
			id: string;
			agent: Agent;
			session: string;
			/** What the agent listed it as, until the replay says otherwise. */
			title: string | null;
			task: string | null;
			/** The branch `task` was cut from. */
			base?: string | null;
			cwd: string;
			log: string;
		},
		{
			fs,
			timer,
			clock,
			launch: run,
			url,
			watch = null,
			root = null,
		}: {
			fs: Fs;
			timer: Timer;
			clock: WallClock;
			launch: Launch;
			url: string | null;
			watch?: Watch | null;
			root?: string | null;
		},
	): Promise<Conversation> {
		const conversation = new Conversation(
			blank(id, agent.id, task, new Date(clock.now()).toISOString(), base),
			log,
			fs,
			timer,
			clock,
			agent,
			cwd,
			run,
			url,
			watch,
			root,
		);
		conversation.write({
			kind: "start",
			id,
			agent: agent.id,
			task,
			cwd,
			base,
			createdAt: conversation.state.createdAt,
		});
		conversation.session = session;
		conversation.write({ kind: "session", session });
		if (title !== null) {
			const update: acp.SessionUpdate = {
				sessionUpdate: "session_info_update",
				title,
			};
			conversation.write({ kind: "update", update });
			fold(conversation.state, update);
		}
		conversation.loading = true;
		conversation.opening = conversation.open(agent, cwd).finally(() => {
			conversation.opening = null;
		});
		return conversation;
	}

	/**
	 * Runs the agent and opens a session with it: the one this conversation
	 * had, when there was one, else a new one.
	 */
	private async open(agent: Agent, cwd: string): Promise<void> {
		this.set({ status: "starting", error: null });
		try {
			// The agent's `arbor` finds its conversation, and the server, in its
			// env, to move the conversation as it takes or lands a task.
			const process = this.run(agent.argv, cwd, {
				ARBOR_CONVERSATION: this.id,
				...(this.url === null ? {} : { ARBOR_DEV: this.url }),
			});
			this.process = process;
			void process.exited.then((code) => {
				if (this.process === process) {
					void this.close(
						process.stderr().trim() || `${agent.name} exited with code ${code}`,
					);
				}
			});
			const connection = new acp.ClientSideConnection(
				() => this.client(),
				acp.ndJsonStream(process.input, process.output),
			);
			this.connection = connection;
			const initialized = await connection.initialize({
				protocolVersion: acp.PROTOCOL_VERSION,
				// A form is how an agent asks the person a question, Claude's
				// AskUserQuestion among them; without it the agent asks in prose.
				clientCapabilities: {
					elicitation: { form: {} },
					session: { configOptions: { boolean: {} } },
				},
			});
			this.steers = steers(initialized);
			this.sees =
				initialized.agentCapabilities?.promptCapabilities?.image === true;
			if (this.session === null) {
				const session = await connection.newSession({ cwd, mcpServers: [] });
				this.session = session.sessionId;
				this.write({ kind: "session", session: session.sessionId });
				this.state.settings = settingsIn(session.configOptions);
			} else if (this.loading) {
				const session = await connection.loadSession({
					sessionId: this.session,
					cwd,
					mcpServers: [],
				});
				this.loading = false;
				this.logHeard();
				this.state.settings = settingsIn(session.configOptions);
			} else {
				const session = await connection.resumeSession({
					sessionId: this.session,
					cwd,
					mcpServers: [],
				});
				this.state.settings = settingsIn(session.configOptions);
			}
			const asked =
				this.model === null
					? null
					: modelOption(this.state.settings, this.model);
			this.model = null;
			const picks =
				asked === null
					? this.picks
					: { ...this.picks, [asked.setting]: asked.value };
			this.picks = {};
			for (const [id, value] of Object.entries(picks)) {
				const setting = this.state.settings.find((each) => each.id === id);
				if (
					setting !== undefined &&
					setting.current !== value &&
					setting.options.some((option) => option.value === value)
				) {
					const response = await connection.setSessionConfigOption({
						sessionId: this.session,
						configId: id,
						...configValue(setting, value),
					});
					this.state.settings = settingsIn(response.configOptions);
				}
			}
			this.write({ kind: "settings", settings: this.state.settings });
			this.set({ status: "idle" });
		} catch (error) {
			await this.close(messageOf(error));
		}
	}

	/**
	 * Watches each command the agent runs from when it starts, and keeps what
	 * it did to git that it should not have once it ends.
	 */
	private watchCommand(update: acp.SessionUpdate): void {
		if (
			this.watch === null ||
			this.cwd === null ||
			(update.sessionUpdate !== "tool_call" &&
				update.sessionUpdate !== "tool_call_update")
		) {
			return;
		}
		const tool = toolIn(this.state, update.toolCallId);
		if (tool?.kind !== "execute") {
			return;
		}
		const watched = this.watching.get(tool.id);
		if (tool.status !== "completed" && tool.status !== "failed") {
			if (watched === undefined) {
				this.watching.set(tool.id, this.watch.command(this.cwd));
			}
			return;
		}
		if (watched === undefined) {
			return;
		}
		this.watching.delete(tool.id);
		void watched
			.done(tool.command)
			.then((flags) => {
				if (flags.length > 0) {
					tool.flags = flags;
					this.write({ kind: "flags", tool: tool.id, flags });
					this.changed();
				}
			})
			// Git it cannot read is nothing to flag.
			.catch(() => {});
	}

	/** What the agent may ask of this side, all of it routed to the person. */
	private client(): acp.Client {
		return {
			sessionUpdate: async ({ update }) => {
				// A replay says the person's words too, which the log keeps as
				// prompts, as though said here; it says nothing of when.
				if (this.loading) {
					if (update.sessionUpdate === "user_message_chunk") {
						if (update.content.type === "text") {
							this.heard = (this.heard ?? "") + update.content.text;
						}
						return;
					}
					this.logHeard();
					this.write({ kind: "update", update });
					fold(this.state, update);
					this.changed();
					return;
				}
				const at = this.now();
				// Claude starts a turn of its own when a task it left running in
				// the background ends: a turn like any, though no prompt ends it.
				if (this.tells && this.state.status === "idle" && starts(update)) {
					this.unprompted = true;
					this.set({ status: "running" });
				}
				this.write({ kind: "update", update, at });
				fold(this.state, update, at);
				this.watchCommand(update);
				this.changed();
				if (result(update)) {
					this.tells = true;
					if (this.unprompted) {
						this.ended(null);
					}
				}
			},
			requestPermission: async (params) => {
				const { toolCall } = params;
				const title = toolCall.title ?? "Allow this?";
				// An agent may ask before it says it is making the call.
				if (toolIn(this.state, toolCall.toolCallId) === null) {
					const at = this.now();
					const update: acp.SessionUpdate = {
						sessionUpdate: "tool_call",
						toolCallId: toolCall.toolCallId,
						title,
						kind: toolCall.kind ?? undefined,
						rawInput: toolCall.rawInput,
						locations: toolCall.locations ?? undefined,
						_meta: toolCall._meta,
					};
					this.write({ kind: "update", update, at });
					fold(this.state, update, at);
				}
				const answer = await this.ask({
					type: "permission",
					id: toolCall.toolCallId,
					title,
					options: params.options.map((option) => ({
						id: option.optionId,
						name: option.name,
						kind: option.kind,
					})),
				});
				this.decided(toolCall.toolCallId, params.options, answer);
				return answer.type === "permission"
					? { outcome: { outcome: "selected", optionId: answer.option } }
					: { outcome: { outcome: "cancelled" } };
			},
			createElicitation: async (params) => {
				if (params.mode !== "form") {
					return { action: "decline" };
				}
				const answer = await this.ask({
					type: "question",
					id: crypto.randomUUID(),
					message: params.message,
					fields: fieldsIn(params.requestedSchema),
				});
				return answer.type === "question"
					? { action: "accept", content: answer.values }
					: { action: "decline" };
			},
		};
	}

	/** Logs the person's words the replay has said, as one prompt. */
	private logHeard(): void {
		const text = this.heard?.trim() ?? "";
		this.heard = null;
		if (text === "") {
			return;
		}
		this.write({ kind: "prompt", text });
		this.state.messages.push(said(text, null));
		this.changed();
	}

	/** Keeps how the person answered the permission asked for tool call `id`. */
	private decided(
		id: string,
		options: acp.PermissionOption[],
		answer: Answer,
	): void {
		const tool = toolIn(this.state, id);
		if (tool === null) {
			return;
		}
		const picked =
			answer.type === "permission"
				? options.find((option) => option.optionId === answer.option)
				: undefined;
		const decision: Decision = {
			option:
				picked === undefined ? null : { name: picked.name, kind: picked.kind },
			at: this.now(),
		};
		tool.decision = decision;
		this.write({ kind: "decision", tool: id, decision });
		this.changed();
	}

	/** Holds `ask` until the person answers it, or the turn is cancelled. */
	private ask(asked: Asked): Promise<Answer> {
		this.settle?.({ type: "dismiss" });
		return new Promise((resolve) => {
			this.settle = resolve;
			this.set({ ask: { ...asked, at: this.now() } });
		});
	}

	/**
	 * Says `text` to the agent, with `images`, once it has started, resuming
	 * the session first when it stopped. While the agent works, it joins the
	 * running turn when the agent can take it there, and otherwise waits for
	 * the turn to end.
	 */
	async prompt(text: string, images: Upload[] = []): Promise<void> {
		const words = text.trim();
		if (words === "" && images.length === 0) {
			fail("usage", "say something to the agent", { conversation: this.id });
		}
		const unknown = images.find((each) => !(each.mimeType in IMAGE_TYPES));
		if (unknown !== undefined) {
			fail(
				"usage",
				`send a PNG, JPEG, GIF or WebP image, not ${unknown.mimeType || "an untyped file"}`,
				{ conversation: this.id },
			);
		}
		if (this.state.status === "stopped" || this.state.status === "failed") {
			await this.resume();
		}
		// Held while the agent starts, it finds a turn running only because a
		// message said before it started one, which has yet to reach the agent:
		// steered in, it would join that message rather than follow it.
		const waited = this.opening !== null;
		await this.opening;
		// Said after a checkpoint ended, the work goes on past it.
		if (
			words !== CHECKPOINT &&
			this.state.checkpoint !== null &&
			this.state.checkpoint !== "asked"
		) {
			this.mark(null);
		}
		if (
			(this.state.status !== "idle" && this.state.status !== "running") ||
			this.connection === null
		) {
			fail(
				"usage",
				`conversation ${this.id} is ${this.state.status}: wait for the agent, or cancel its turn`,
				{ conversation: this.id },
			);
		}
		if (images.length > 0 && !this.sees) {
			fail("usage", `${this.agent?.name ?? "the agent"} does not take images`, {
				conversation: this.id,
			});
		}
		const kept = await this.keep(images);
		if (this.state.status === "running") {
			if (!this.steers || waited) {
				this.queue(words, kept);
				return;
			}
			// Said into the turn first, so a refusal leaves nothing in the thread.
			const { outcome } = await this.connection.request<{ outcome?: string }>(
				STEER,
				{
					sessionId: this.session ?? "",
					prompt: await this.content([said(words, null, kept)]),
					_meta: { steering: { idleBehavior: "promptRequired" } },
				},
			);
			if (outcome === "injected" || outcome === "startedNewTurn") {
				const at = this.now();
				this.write({ kind: "prompt", text: words, at, ...shown(kept) });
				this.state.messages.push(said(words, at, kept));
				this.changed();
				return;
			}
			if (outcome !== "promptRequired") {
				fail("usage", `${this.agent?.name ?? "the agent"} did not take it`, {
					conversation: this.id,
				});
			}
			// The turn ended on the way: a turn of its own, then, or after the
			// next one if that has started.
			// Read again: the turn may have ended while the agent answered.
			if ((this.state.status as Status) !== "idle") {
				this.queue(words, kept);
				return;
			}
		}
		this.held = false;
		const at = this.now();
		const message = said(words, at, kept);
		this.write({ kind: "prompt", text: words, at, ...shown(kept) });
		this.state.messages.push(message);
		this.send([message]);
	}

	/** Holds `words` and `images` for when the turn ends, shown as said. */
	private queue(words: string, images: Image[]): void {
		const at = this.now();
		this.write({
			kind: "prompt",
			text: words,
			at,
			queued: true,
			...shown(images),
		});
		this.state.messages.push({ ...said(words, at, images), queued: true });
		this.changed();
	}

	/**
	 * Saves each image beside the log, named for what is in it, so the page
	 * reads it by name rather than with every change to the conversation.
	 */
	private async keep(images: Upload[]): Promise<Image[]> {
		if (images.length === 0) {
			return [];
		}
		await this.fs.mkdir(this.images());
		return Promise.all(
			images.map(async ({ mimeType, data }) => {
				const bytes = new Uint8Array(Buffer.from(data, "base64"));
				const hash = createHash("sha256").update(bytes).digest("hex");
				const name = `${hash.slice(0, 16)}.${IMAGE_TYPES[mimeType]}`;
				await this.fs.writeBytes(`${this.images()}/${name}`, bytes);
				return { name, mimeType };
			}),
		);
	}

	/** Where its images are kept. */
	private images(): string {
		return this.log.replace(/\.jsonl$/, "");
	}

	/** The image `name` the person sent, or null when they sent none by that name. */
	async image(
		name: string,
	): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
		const part = this.state.messages
			.flatMap((message) => message.parts)
			.find((each) => each.type === "image" && each.name === name);
		if (part?.type !== "image") {
			return null;
		}
		const bytes = await this.fs
			.readBytes(`${this.images()}/${name}`)
			.catch(() => null);
		return bytes === null ? null : { bytes, mimeType: part.mimeType };
	}

	/** What `messages` say, as one prompt: their images, then their words. */
	private async content(messages: Message[]): Promise<acp.ContentBlock[]> {
		const images = await Promise.all(
			messages
				.flatMap((message) => message.parts)
				.flatMap((part) => (part.type === "image" ? [part] : []))
				.map(
					async (part): Promise<acp.ContentBlock> => ({
						type: "image",
						mimeType: part.mimeType,
						data: Buffer.from(
							await this.fs.readBytes(`${this.images()}/${part.name}`),
						).toString("base64"),
					}),
				),
		);
		const text = messages
			.map(textOf)
			.filter((each) => each !== "")
			.join("\n\n");
		return [
			...images,
			...(text === "" ? [] : [{ type: "text" as const, text }]),
		];
	}

	/**
	 * Starts a turn on `fresh`, with every message still queued ahead of it,
	 * as one prompt, or on `fresh` alone, leaving the queue as it is.
	 */
	private send(fresh: Message[], { alone = false } = {}): void {
		const waiting = alone
			? []
			: this.state.messages.filter((each) => each.queued);
		if (waiting.length > 0) {
			delivered(this.state.messages);
			this.write({ kind: "sent" });
		}
		this.set({ status: "running" });
		void this.content([...waiting, ...fresh])
			.then((prompt) =>
				this.connection?.prompt({ sessionId: this.session ?? "", prompt }),
			)
			.then(
				(response) => {
					if (response?.usage != null) {
						this.write({ kind: "usage", usage: response.usage });
						tally(this.state, response.usage);
					}
					this.ended(null);
				},
				(error: unknown) => this.ended(messageOf(error)),
			);
	}

	/**
	 * Back to idle once a turn ends, then on to what was queued meanwhile,
	 * unless the person cancelled the turn: that holds the queue until they
	 * say something.
	 */
	private ended(error: string | null): void {
		if (this.state.status !== "running") {
			return;
		}
		this.unprompted = false;
		this.set({ status: "idle", ...(error === null ? {} : { error }) });
		this.flag(true);
		if (!this.held && this.state.messages.some((each) => each.queued)) {
			this.send([]);
		}
		// Still idle: the checkpoint was in the turn that ended, not queued.
		if (
			this.state.checkpoint === "asked" &&
			!this.interrupting &&
			(this.state.status as Status) === "idle"
		) {
			this.mark(error === null ? "done" : "failed");
		}
	}

	/** Whether a checkpoint has ended and nothing has been said since. */
	get stoppedByCheckpoint(): boolean {
		const { checkpoint } = this.state;
		return checkpoint !== null && checkpoint !== "asked";
	}

	/**
	 * Asks the agent to bring its `ARBOR.md` up to date and stop, cancelling
	 * the turn it is on first, unless that turn is `merging`, which it says
	 * the checkpoint into, or queues it after. What the person queued stays
	 * queued, for the next prompt to send.
	 */
	async checkpoint(merging: boolean): Promise<void> {
		await this.opening;
		if (
			this.state.checkpoint === "asked" ||
			(this.state.status !== "idle" && this.state.status !== "running")
		) {
			return;
		}
		// Asked from the start, so an agent slow to stop shows as on its way,
		// and one that never stops runs out the same wait.
		this.mark("asked");
		this.waiting?.dispose();
		this.waiting = this.timer.setTimeout(() => {
			if (this.state.checkpoint === "asked") {
				this.mark("unanswered");
			}
		}, CHECKPOINT_WAIT);
		if (this.state.status === "running" && !merging) {
			this.interrupting = true;
			try {
				await this.halt();
				await this.idle();
			} finally {
				this.interrupting = false;
			}
			if (
				(this.state.checkpoint as Checkpoint | null) !== "asked" ||
				(this.state.status as Status) !== "idle"
			) {
				return;
			}
		}
		if (this.state.status === "running") {
			await this.prompt(CHECKPOINT);
			return;
		}
		// Held, so nothing queued follows the checkpoint on its own.
		this.held = true;
		const at = this.now();
		this.write({ kind: "prompt", text: CHECKPOINT, at });
		const message = said(CHECKPOINT, at);
		this.state.messages.push(message);
		this.send([message], { alone: true });
	}

	/**
	 * Forgets the checkpoint, done or not, so the next starts afresh; an agent
	 * still on it carries on with its turn.
	 */
	dismissCheckpoint(): void {
		if (this.state.checkpoint !== null) {
			this.mark(null);
		}
	}

	private mark(checkpoint: Checkpoint | null): void {
		if (checkpoint !== "asked") {
			this.waiting?.dispose();
			this.waiting = null;
		}
		this.write({ kind: "checkpoint", checkpoint });
		this.set({ checkpoint });
	}

	/** Settles once the checkpoint asked is no longer under way. */
	answered(): Promise<void> {
		return new Promise((resolve) => {
			const check = () => {
				if (this.state.checkpoint !== "asked") {
					off();
					resolve();
				}
			};
			const off = this.events.on("changed", check);
			check();
		});
	}

	/** Settles once no turn is running, or the checkpoint has given up. */
	private idle(): Promise<void> {
		return new Promise((resolve) => {
			const check = () => {
				if (
					this.state.status !== "running" ||
					this.state.checkpoint !== "asked"
				) {
					off();
					resolve();
				}
			};
			const off = this.events.on("changed", check);
			check();
		});
	}

	/**
	 * Takes back the `index`th queued message before the agent hears it,
	 * answering with its words and images, for the person to edit and send
	 * again.
	 */
	unqueue(index: number): { text: string; images: Image[] } {
		const message = takeBack(this.state.messages, index);
		if (message === null) {
			fail(
				"not_found",
				`conversation ${this.id} has no queued message ${index}`,
				{
					conversation: this.id,
				},
			);
		}
		this.write({ kind: "unqueue", index });
		this.changed();
		return {
			text: textOf(message),
			images: message.parts.flatMap((part) =>
				part.type === "image"
					? [{ name: part.name, mimeType: part.mimeType }]
					: [],
			),
		};
	}

	/**
	 * Sends what is queued now: stops the running turn, whose end sends it,
	 * or, with no turn running, sends it as one.
	 */
	async sendNow(): Promise<void> {
		if (!this.state.messages.some((each) => each.queued)) {
			return;
		}
		if (this.state.status === "running") {
			await this.halt();
			// After `halt`, which holds the queue for a stop.
			this.held = false;
			return;
		}
		if (this.state.status === "stopped" || this.state.status === "failed") {
			await this.resume();
		}
		await this.opening;
		if (this.state.status === "idle") {
			this.held = false;
			this.send([]);
		}
	}

	/** Settles the agent's pending ask, if `id` is still the one it is on. */
	answer(id: string, answer: Answer): void {
		if (this.state.ask?.id !== id) {
			fail("not_found", `conversation ${this.id} is not asking ${id}`, {
				conversation: this.id,
			});
		}
		const settle = this.settle;
		this.settle = null;
		this.set({ ask: null });
		settle?.(answer);
	}

	/**
	 * Stops the agent's turn for the person, marking the turn as one they
	 * stopped, and leaves the conversation open for the next.
	 */
	async cancel(): Promise<void> {
		if (this.state.status === "running") {
			const at = this.now();
			this.write({ kind: "stopped", at });
			agentTurn(this.state, at).stopped = at;
			this.changed();
		}
		await this.halt();
	}

	/** Stops the agent's turn, holding what is queued for the next prompt. */
	private async halt(): Promise<void> {
		this.held = true;
		if (this.settle !== null) {
			this.answer(this.state.ask?.id ?? "", { type: "dismiss" });
		}
		if (this.connection !== null && this.session !== null) {
			await this.connection.cancel({ sessionId: this.session });
		}
	}

	/**
	 * Sets the session's setting `id` to `value`, one the agent offers: at once
	 * while the agent runs, or, while it is stopped, when it next resumes.
	 */
	async choose(id: string, value: string): Promise<void> {
		await this.opening;
		const setting = this.state.settings.find((each) => each.id === id);
		if (setting === undefined) {
			fail("usage", `conversation ${this.id} has no setting '${id}'`, {
				conversation: this.id,
			});
		}
		if (!setting.options.some((option) => option.value === value)) {
			fail(
				"usage",
				`'${value}' is not a ${setting.name.toLowerCase()} this agent offers`,
				{ conversation: this.id },
			);
		}
		if (this.connection === null || this.session === null) {
			this.picks = { ...this.picks, [id]: value };
			const settings = this.state.settings.map((each) =>
				each.id === id ? { ...each, current: value } : each,
			);
			this.write({ kind: "settings", settings });
			this.set({ settings });
			return;
		}
		const response = await this.connection.setSessionConfigOption({
			sessionId: this.session,
			configId: id,
			...configValue(setting, value),
		});
		const settings = settingsIn(response.configOptions);
		this.write({ kind: "settings", settings });
		this.set({ settings });
	}

	/** Brings a stopped conversation back: a new process, the same session. */
	private async resume(): Promise<void> {
		if (this.state.archived) {
			fail("usage", `conversation ${this.id} is archived: unarchive it first`, {
				conversation: this.id,
			});
		}
		if (this.agent === null || this.cwd === null || this.session === null) {
			fail(
				"usage",
				`conversation ${this.id} cannot resume: its log predates resuming`,
				{ conversation: this.id },
			);
		}
		// Its task landed or went without the agent's `arbor` reaching this
		// server to move it, so it carries on in the main tree.
		if (!(await this.fs.exists(this.cwd))) {
			if (this.root === null) {
				fail(
					"not_found",
					`conversation ${this.id} cannot resume: ${this.cwd} is gone`,
					{ conversation: this.id },
				);
			}
			this.move(null, this.root);
		}
		this.opening ??= this.open(this.agent, this.cwd).finally(() => {
			this.opening = null;
		});
		await this.opening;
	}

	/**
	 * Follows the agent into a task's worktree, or back to the main tree: a
	 * running session keeps the directory it opened in, and the agent works by
	 * absolute path; a resumed one opens in the new.
	 */
	move(task: string | null, cwd: string, base: string | null = null): void {
		this.cwd = cwd;
		this.write({ kind: "task", task, cwd, base });
		this.set({
			task,
			lastTask: task ?? this.state.lastTask,
			lastBase: task === null ? this.state.lastBase : base,
		});
	}

	/** Stops the agent; the next prompt resumes where it left off. */
	async stop(): Promise<void> {
		await this.close(null);
	}

	/** Stops it and puts it away, off the list of conversations. */
	async archive(): Promise<void> {
		await this.stop();
		await this.put({ archived: true });
	}

	/** Names it `name` over the agent's title; blank goes back to the title. */
	async rename(name: string): Promise<void> {
		const named = name.trim() || null;
		this.write({ kind: "rename", name: named });
		this.saves.flush();
		await this.saving;
		this.set({ name: named });
	}

	/** Back on the list, stopped until the next prompt. */
	async unarchive(): Promise<void> {
		await this.put({ archived: false });
	}

	/** Marks it seen, or unseen again for the person to come back to. */
	async markUnread(unread: boolean): Promise<void> {
		this.flag(unread);
		this.saves.flush();
		await this.saving;
	}

	/** Stops it and deletes its log and images, for good. */
	async delete(): Promise<void> {
		await this.stop();
		await this.saving;
		await this.fs.rm(this.log, { force: true });
		await this.fs.rm(this.images(), { recursive: true, force: true });
	}

	dispose(): void {
		void this.stop();
	}

	private flag(unread: boolean): void {
		if (this.state.unread === unread) {
			return;
		}
		this.write({ kind: "unread", unread });
		this.set(unread ? { unread } : { unread, seen: sent(this.state.messages) });
	}

	private async put({ archived }: { archived: boolean }): Promise<void> {
		if (this.state.archived === archived) {
			return;
		}
		const at = this.now();
		this.write({ kind: "archive", archived, at });
		this.saves.flush();
		await this.saving;
		this.archivedAt = archived ? at : null;
		this.set({ archived });
	}

	private async close(error: string | null): Promise<void> {
		if (this.state.status === "stopped" || this.state.status === "failed") {
			return;
		}
		this.settle?.({ type: "dismiss" });
		this.settle = null;
		this.process?.kill();
		this.process = null;
		this.connection = null;
		if (this.state.checkpoint === "asked") {
			this.mark("failed");
		}
		this.write({ kind: "end", error });
		this.saves.flush();
		await this.saving;
		this.set({
			status: error === null ? "stopped" : "failed",
			error,
			ask: null,
		});
	}

	private write(entry: Entry): void {
		this.unsaved.push(`${JSON.stringify(entry)}\n`);
		this.saves.call(() => {
			const lines = this.unsaved.splice(0).join("");
			this.saving = this.saving
				.then(() => this.fs.append(this.log, lines))
				.catch(() => {});
		});
	}

	private set(next: Partial<ConversationState>): void {
		Object.assign(this.state, next);
		this.changed();
	}

	private changed(): void {
		this.dispatcher.dispatch("changed");
	}
}

/** What the person said, `at`: their images, then their words. */
function said(text: string, at: string | null, images: Image[] = []): Message {
	return {
		role: "user",
		parts: [
			...images.map((image) => ({ type: "image" as const, ...image })),
			...(text === "" ? [] : [{ type: "text" as const, text }]),
		],
		plan: null,
		at,
		until: at,
	};
}

function blank(
	id: string,
	agent: string,
	task: string | null,
	createdAt: string,
	base: string | null = null,
): ConversationState {
	return {
		id,
		agent,
		task,
		lastTask: task,
		lastBase: task === null ? null : base,
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
		unread: false,
		seen: 0,
		checkpoint: null,
		usage: unused(),
	};
}

/** How many of `messages` went out, as the thread shows them. */
function sent(messages: Message[]): number {
	return messages.filter((each) => !each.queued).length;
}

/** What a session has used before its agent says anything of it. */
export function unused(): Usage {
	return { context: null, input: 0, cached: 0, output: 0, cost: null };
}

/** A prompt entry's images, left out of the log when there are none. */
function shown(images: Image[]): { images?: Image[] } {
	return images.length === 0 ? {} : { images };
}

/** The words of `message`, without its images. */
function textOf(message: Message): string {
	return message.parts
		.map((part) => (part.type === "text" ? part.text : ""))
		.join("");
}

/** The ACP extension that says a prompt into the turn the agent is running. */
const STEER = "_session/steering";

/** Whether an agent says, as it starts, that it takes `STEER`. */
function steers(initialized: acp.InitializeResponse): boolean {
	const steering = initialized._meta?.steering;
	return (
		typeof steering === "object" &&
		steering !== null &&
		"supported" in steering &&
		steering.supported === true
	);
}

/** Marks every queued message as gone out. */
function delivered(messages: Message[]): void {
	for (const each of messages) {
		delete each.queued;
	}
}

/** Removes the `index`th queued message, returning it if there was one. */
function takeBack(messages: Message[], index: number): Message | null {
	const queued = messages.filter((each) => each.queued);
	const message = queued[index];
	if (message === undefined) {
		return null;
	}
	messages.splice(messages.indexOf(message), 1);
	return message;
}

function messageOf(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	if (typeof error === "object" && error !== null && "message" in error) {
		return String(error.message);
	}
	return String(error);
}

/** How many archived conversations are kept; older archived ones are deleted. */
export const ARCHIVED_KEPT = 50;

/** `changed` and `removed` each carry a conversation's id. */
export type ConversationsEvents = { changed: string; removed: string };

/**
 * Every conversation in the repo: the live ones this process started, and
 * the stopped ones read back from their logs, one JSON-lines file each under
 * `.git/arbor/conversations`.
 */
export class Conversations implements Eventful<ConversationsEvents>, Resource {
	private readonly dispatcher = new Dispatcher<ConversationsEvents>();
	readonly events = this.dispatcher.events;

	private readonly known = new Map<string, Conversation>();
	private readonly fs: Fs;
	private readonly ids: IdProvider;
	private readonly run: Launch;
	private readonly timer: Timer;
	private readonly clock: WallClock;
	private readonly watch: Watch | null;
	private readonly offered: Offered | null;
	private readonly root: string | null;
	/** The read of the records on disk, shared by every caller until it settles. */
	private loaded: Promise<void> | null = null;
	/** The last deletion of archived conversations past `ARCHIVED_KEPT`, so they run one at a time. */
	private pruning: Promise<void> = Promise.resolve();
	/** Where `arbor dev` answers, once it does, for the agents' CLI. */
	url: string | null = null;

	constructor(
		readonly dir: string,
		readonly agents: Agent[],
		opts: ConversationsOptions = {},
	) {
		this.fs = opts.fs ?? new NodeFs();
		this.ids = opts.ids ?? new UuidProvider();
		this.run = opts.launch ?? launch;
		this.timer = opts.timer ?? new SystemTimer();
		this.clock = opts.clock ?? new SystemWallClock();
		this.watch = opts.watch ?? null;
		this.offered = opts.offered ?? null;
		this.root = opts.root ?? null;
	}

	/**
	 * What each agent's sessions last offered, from any project, by its id:
	 * what a first conversation with one shows before it starts.
	 */
	async settings(): Promise<Record<string, Setting[]>> {
		return (await this.offered?.all()) ?? {};
	}

	/** Every conversation, newest first. */
	async list(): Promise<Conversation[]> {
		await this.load();
		return [...this.known.values()].sort((one, other) =>
			other.state.createdAt.localeCompare(one.state.createdAt),
		);
	}

	async find(id: string): Promise<Conversation> {
		await this.load();
		const found = this.known.get(id);
		if (found === undefined) {
			fail("not_found", `no conversation ${id}`, { conversation: id });
		}
		return found;
	}

	/**
	 * Starts a conversation with `agent` in `cwd`, for `task` if it is one's,
	 * with `settings` set once the session offers them.
	 */
	async start(
		agent: string,
		{
			task,
			base,
			cwd,
			settings,
			model,
		}: {
			task: string | null;
			/** The branch `task` was cut from. */
			base?: string | null;
			cwd: string;
			settings?: Record<string, string>;
			/** The model to start on, by its value or name in the model setting. */
			model?: string;
		},
	): Promise<Conversation> {
		const chosen = this.agents.find((each) => each.id === agent);
		if (chosen === undefined) {
			fail(
				"usage",
				`no agent '${agent}': use one of ${this.agents.map((each) => each.id).join(", ")}`,
				{ agent },
			);
		}
		await this.load();
		await this.fs.mkdir(this.dir);
		const id = this.ids.next();
		const conversation = await Conversation.start(
			{
				id,
				agent: chosen,
				task,
				base,
				cwd,
				log: `${this.dir}/${id}.jsonl`,
				settings,
				model,
			},
			{
				fs: this.fs,
				timer: this.timer,
				clock: this.clock,
				launch: this.run,
				url: this.url,
				watch: this.watch,
				root: this.root,
			},
		);
		this.track(conversation);
		return conversation;
	}

	/**
	 * The sessions each agent holds in `cwd` that arbor does not, such as ones
	 * started in its CLI, to bring in: newest first, from every agent that
	 * lists and loads sessions.
	 */
	async sessions(cwd: string): Promise<Session[]> {
		await this.load();
		const held = new Set(
			[...this.known.values()].map(
				(each) => `${each.state.agent} ${each.sessionId}`,
			),
		);
		const listed = await Promise.all(
			this.agents.map((agent) =>
				listSessions(agent, cwd, this.run, this.timer).catch(
					(): Session[] => [],
				),
			),
		);
		return listed
			.flat()
			.filter((each) => !held.has(`${each.agent} ${each.session}`))
			.sort((one, other) =>
				(other.updatedAt ?? "").localeCompare(one.updatedAt ?? ""),
			);
	}

	/**
	 * Brings in `session`, one `agent` holds outside arbor, as a conversation
	 * in `cwd`, for `task` if it is one's.
	 */
	async bring(
		agent: string,
		session: string,
		{
			task,
			base,
			cwd,
			title = null,
		}: {
			task: string | null;
			/** The branch `task` was cut from. */
			base?: string | null;
			cwd: string;
			title?: string | null;
		},
	): Promise<Conversation> {
		const chosen = this.agents.find((each) => each.id === agent);
		if (chosen === undefined) {
			fail(
				"usage",
				`no agent '${agent}': use one of ${this.agents.map((each) => each.id).join(", ")}`,
				{ agent },
			);
		}
		await this.load();
		const holding = [...this.known.values()].find(
			(each) => each.state.agent === agent && each.sessionId === session,
		);
		if (holding !== undefined) {
			fail(
				"usage",
				`session ${session} is already conversation ${holding.id}`,
				{ conversation: holding.id },
			);
		}
		await this.fs.mkdir(this.dir);
		const id = this.ids.next();
		const conversation = await Conversation.bring(
			{
				id,
				agent: chosen,
				session,
				title,
				task,
				base,
				cwd,
				log: `${this.dir}/${id}.jsonl`,
			},
			{
				fs: this.fs,
				timer: this.timer,
				clock: this.clock,
				launch: this.run,
				url: this.url,
				watch: this.watch,
				root: this.root,
			},
		);
		this.track(conversation);
		return conversation;
	}

	/**
	 * Deletes the archived conversations past the `ARCHIVED_KEPT` archived
	 * most recently, so their logs do not pile up.
	 */
	prune(): Promise<void> {
		this.pruning = this.pruning.then(async () => {
			await this.load();
			await this.trim();
		});
		return this.pruning;
	}

	/** Stops every live conversation, so no agent outlives the server. */
	async disposeAsync(): Promise<void> {
		await Promise.all([...this.known.values()].map((each) => each.stop()));
	}

	dispose(): void {
		void this.disposeAsync();
	}

	private track(conversation: Conversation): void {
		this.known.set(conversation.id, conversation);
		// Only what changes from here: a log read back may be older than what
		// another project's sessions offered since.
		let remembered = conversation.state.settings;
		let archived = conversation.state.archived;
		conversation.events.on("changed", () => {
			const { agent, settings } = conversation.state;
			if (settings !== remembered && settings.length > 0) {
				remembered = settings;
				void this.offered?.remember(agent, settings).catch(() => {});
			}
			if (conversation.state.archived && !archived) {
				void this.prune().catch(() => {});
			}
			archived = conversation.state.archived;
			this.dispatcher.dispatch("changed", conversation.id);
		});
		this.dispatcher.dispatch("changed", conversation.id);
	}

	private load(): Promise<void> {
		// Logs archived before any were deleted go as they are read back.
		this.loaded ??= this.read().then(() => this.trim());
		return this.loaded;
	}

	private async trim(): Promise<void> {
		const archived = [...this.known.values()]
			.filter((each) => each.state.archived)
			.sort((one, other) =>
				(other.archivedSince ?? "").localeCompare(one.archivedSince ?? ""),
			);
		for (const each of archived.slice(ARCHIVED_KEPT)) {
			this.known.delete(each.id);
			await each.delete();
			this.dispatcher.dispatch("removed", each.id);
		}
	}

	private async read(): Promise<void> {
		const names = (await this.fs.exists(this.dir))
			? await this.fs.readdir(this.dir)
			: [];
		for (const name of names.filter((each) => each.endsWith(".jsonl"))) {
			const read = await Conversation.read(`${this.dir}/${name}`, {
				fs: this.fs,
				timer: this.timer,
				clock: this.clock,
				agents: this.agents,
				launch: this.run,
				url: this.url,
				watch: this.watch,
				root: this.root,
			});
			if (read !== null && !this.known.has(read.id)) {
				this.track(read);
			}
		}
	}
}

/** A session an agent holds that arbor could bring in. */
export interface Session {
	agent: string;
	session: string;
	title: string | null;
	/** When it was last active, as the agent says; null when it does not. */
	updatedAt: string | null;
}

/** How long an agent has to start and list its sessions. */
const LIST_WAIT = Duration.secs(30);

/** How many pages of sessions are read from an agent, at most. */
const LIST_PAGES = 10;

/**
 * The sessions `agent` holds in `cwd`, asked of a process of its own that
 * stops once it answers; none when it cannot both list and load them.
 */
async function listSessions(
	agent: Agent,
	cwd: string,
	run: Launch,
	timer: Timer,
): Promise<Session[]> {
	const process = run(agent.argv, cwd, {});
	let timeout: Resource | null = null;
	try {
		const connection = new acp.ClientSideConnection(
			() => ({
				sessionUpdate: async () => {},
				requestPermission: async () => ({ outcome: { outcome: "cancelled" } }),
			}),
			acp.ndJsonStream(process.input, process.output),
		);
		const listing = (async () => {
			const initialized = await connection.initialize({
				protocolVersion: acp.PROTOCOL_VERSION,
				clientCapabilities: {},
			});
			const capabilities = initialized.agentCapabilities;
			if (
				capabilities?.loadSession !== true ||
				capabilities.sessionCapabilities?.list == null
			) {
				return [];
			}
			const sessions: Session[] = [];
			let cursor: string | null = null;
			for (let page = 0; page < LIST_PAGES; page++) {
				const listed: acp.ListSessionsResponse = await connection.listSessions({
					cwd,
					cursor,
				});
				for (const each of listed.sessions) {
					// An agent may list more than it was asked for.
					if (each.cwd === cwd) {
						sessions.push({
							agent: agent.id,
							session: each.sessionId,
							title: each.title ?? null,
							updatedAt: each.updatedAt ?? null,
						});
					}
				}
				cursor = listed.nextCursor ?? null;
				if (cursor === null) {
					break;
				}
			}
			return sessions;
		})();
		const gaveUp = new Promise<never>((_, reject) => {
			timeout = timer.setTimeout(
				() => reject(new Error(`${agent.name} did not list its sessions`)),
				LIST_WAIT,
			);
		});
		const died = process.exited.then((code): never => {
			throw new Error(`${agent.name} exited with code ${code}`);
		});
		return await Promise.race([listing, gaveUp, died]);
	} finally {
		(timeout as Resource | null)?.dispose();
		process.kill();
	}
}

export interface ConversationsOptions {
	fs?: Fs;
	ids?: IdProvider;
	launch?: Launch;
	timer?: Timer;
	clock?: WallClock;
	/** What watches the agents' commands for what they do to git; none by default. */
	watch?: Watch | null;
	/** Where what each agent's sessions offer is kept across projects; nowhere by default. */
	offered?: Offered | null;
	/**
	 * The main tree, where a conversation carries on once its task's worktree
	 * is gone, as when the task landed while `arbor dev` was not there to hear
	 * of it; without it, such a conversation cannot resume.
	 */
	root?: string | null;
}
