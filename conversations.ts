import * as acp from "@agentclientprotocol/sdk";
import type { Resource } from "webappwiz/disposable";
import { Dispatcher, type Eventful } from "webappwiz/events";
import { type IdProvider, UuidProvider } from "webappwiz/id";
import { type Fs, NodeFs } from "webappwiz/system";
import {
	Duration,
	SystemTimer,
	SystemWallClock,
	Throttler,
	type Timer,
	type WallClock,
} from "webappwiz/time";
import { fail } from "./exit";

/** An agent arbor can hold a conversation with over ACP, and how to start it. */
export interface Agent {
	id: string;
	name: string;
	argv: string[];
}

/**
 * The agents a conversation can be started with, until a roster says which.
 * Each is the ACP adapter its maker publishes, fetched by `bunx` on first use.
 */
export const AGENTS: Agent[] = [
	{
		id: "claude",
		name: "Claude",
		argv: ["bunx", "@agentclientprotocol/claude-agent-acp"],
	},
	{
		id: "codex",
		name: "Codex",
		argv: ["bunx", "@agentclientprotocol/codex-acp"],
	},
];

/** A running agent: bytes in, bytes out, and a way to stop it. */
export interface AgentProcess {
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

// TODO: webappwiz/system once `Ps` can start a child with its stdio left open
export const launch: Launch = (argv, cwd, env) => {
	const child = Bun.spawn(argv, {
		cwd,
		env: { ...process.env, ...env },
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
	});
	let tail = "";
	void (async () => {
		const decoder = new TextDecoder();
		for await (const chunk of child.stderr) {
			tail = (tail + decoder.decode(chunk)).slice(-STDERR_CHARS);
		}
	})();
	return {
		input: new WritableStream({
			write: (chunk) => {
				child.stdin.write(chunk);
			},
			close: () => {
				child.stdin.end();
			},
		}),
		output: child.stdout,
		stderr: () => tail,
		exited: child.exited,
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
	| Tool;

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
	/** What it sets, as ACP names it: mode, model, thought_level, or its own. */
	category: string | null;
	current: string;
	options: { value: string; name: string; description: string | null }[];
}

/**
 * Where the agent is: `stopped` and `failed` have no process, and the next
 * prompt resumes the session in a new one.
 */
export type Status = "starting" | "idle" | "running" | "stopped" | "failed";

/** Everything the page shows of one conversation. */
export interface ConversationState {
	id: string;
	agent: string;
	/** The task whose worktree it runs in; null for the main tree. */
	task: string | null;
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
	createdAt: string;
	/** Put away: stopped, kept off the list, shown with the archived ones. */
	archived: boolean;
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
			createdAt: string;
	  }
	| { kind: "session"; session: string }
	/** Moved into a task's worktree, or back to the main tree. */
	| { kind: "task"; task: string | null; cwd: string }
	/** What the session offered and had set, kept so the next one can start alike. */
	| { kind: "settings"; settings: Setting[] }
	| { kind: "archive"; archived: boolean }
	| { kind: "rename"; name: string | null }
	/** `at` is missing from logs written before the page showed how long things took. */
	| { kind: "prompt"; text: string; at?: string; queued?: true }
	/** Every queued prompt went out. */
	| { kind: "sent" }
	/** The `index`th queued prompt was taken back. */
	| { kind: "unqueue"; index: number }
	| { kind: "update"; update: acp.SessionUpdate; at?: string }
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
			const tool: Tool = {
				type: "tool",
				id: update.toolCallId,
				title: update.title,
				status: "pending",
				kind: update.kind ?? null,
				command: null,
				output: "",
				edits: [],
				paths: [],
				parent: parentOf(update),
				at,
				until: null,
			};
			agentTurn(state, at).parts.push(tool);
			fill(tool, update, at);
			return;
		}
		case "tool_call_update": {
			const part = state.messages
				.flatMap((message) => message.parts)
				.find((each) => each.type === "tool" && each.id === update.toolCallId);
			if (part?.type === "tool") {
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

/**
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

/** Marks the agent's message at the end, if it is the last, as having moved `at`. */
function moved(state: ConversationState, at: string | null): void {
	const last = state.messages.at(-1);
	if (last?.role === "agent" && at !== null) {
		last.until = at;
	}
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
	const input = update.rawInput as { command?: unknown } | null | undefined;
	if (typeof input?.command === "string") {
		tool.command = input.command;
	} else if (Array.isArray(input?.command)) {
		tool.command = input.command.join(" ");
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
	return (options ?? []).flatMap((option) => {
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
	/** Whether the person cancelled the last turn, which holds the queue. */
	private held = false;
	/** The log's lines, all of them, since the file is rewritten whole. */
	private readonly lines: string[] = [];
	private saving: Promise<void> = Promise.resolve();
	private readonly saves: Throttler;
	/** Under way while the agent starts or comes back, for a prompt to wait on. */
	private opening: Promise<void> | null = null;
	/** Settings picked before the session opened, set once it has. */
	private picks: Record<string, string> = {};

	private constructor(
		readonly state: ConversationState,
		private readonly log: string,
		private readonly fs: Fs,
		timer: Timer,
		private readonly clock: WallClock,
		/** What to run to resume it; null when its agent is no longer known. */
		private readonly agent: Agent | null,
		/** Where it runs; null for a log too old to say. */
		private cwd: string | null,
		private readonly run: Launch,
		/** Where `arbor dev` answers, for the agent's CLI to tell it things. */
		private readonly url: string | null,
	) {
		this.saves = new Throttler(timer, SAVE_EVERY);
	}

	get id(): string {
		return this.state.id;
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
		}: {
			fs: Fs;
			timer: Timer;
			clock: WallClock;
			agents: Agent[];
			launch: Launch;
			url: string | null;
		},
	): Promise<Conversation | null> {
		const lines = (await fs.read(log)).split("\n").filter(Boolean);
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
			blank(start.id, start.agent, start.task, start.createdAt),
			log,
			fs,
			timer,
			clock,
			agents.find((each) => each.id === start.agent) ?? null,
			start.cwd ?? null,
			run,
			url,
		);
		conversation.lines.push(...lines.map((line) => `${line}\n`));
		const { state } = conversation;
		for (const entry of entries) {
			if (entry.kind === "prompt") {
				state.messages.push({
					...said(entry.text, entry.at ?? null),
					...(entry.queued ? { queued: true } : {}),
				});
			} else if (entry.kind === "sent") {
				delivered(state.messages);
			} else if (entry.kind === "unqueue") {
				takeBack(state.messages, entry.index);
			} else if (entry.kind === "update") {
				fold(state, entry.update, entry.at ?? null);
			} else if (entry.kind === "session") {
				conversation.session = entry.session;
			} else if (entry.kind === "task") {
				state.task = entry.task;
				conversation.cwd = entry.cwd;
			} else if (entry.kind === "settings") {
				state.settings = entry.settings;
			} else if (entry.kind === "archive") {
				state.archived = entry.archived;
			} else if (entry.kind === "rename") {
				state.name = entry.name;
			} else if (entry.kind === "end") {
				state.error = entry.error;
			}
		}
		state.status = state.error === null ? "stopped" : "failed";
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
			cwd,
			log,
			settings = {},
		}: {
			id: string;
			agent: Agent;
			task: string | null;
			cwd: string;
			log: string;
			/** Values to set, by setting id, once the session offers them. */
			settings?: Record<string, string>;
		},
		{
			fs,
			timer,
			clock,
			launch: run,
			url,
		}: {
			fs: Fs;
			timer: Timer;
			clock: WallClock;
			launch: Launch;
			url: string | null;
		},
	): Promise<Conversation> {
		const conversation = new Conversation(
			blank(id, agent.id, task, new Date(clock.now()).toISOString()),
			log,
			fs,
			timer,
			clock,
			agent,
			cwd,
			run,
			url,
		);
		conversation.write({
			kind: "start",
			id,
			agent: agent.id,
			task,
			cwd,
			createdAt: conversation.state.createdAt,
		});
		conversation.picks = settings;
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
				clientCapabilities: { elicitation: { form: {} } },
			});
			this.steers = steers(initialized);
			if (this.session === null) {
				const session = await connection.newSession({ cwd, mcpServers: [] });
				this.session = session.sessionId;
				this.write({ kind: "session", session: session.sessionId });
				this.state.settings = settingsIn(session.configOptions);
			} else {
				const session = await connection.resumeSession({
					sessionId: this.session,
					cwd,
					mcpServers: [],
				});
				this.state.settings = settingsIn(session.configOptions);
			}
			const picks = this.picks;
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
						value,
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

	/** What the agent may ask of this side, all of it routed to the person. */
	private client(): acp.Client {
		return {
			sessionUpdate: async ({ update }) => {
				const at = this.now();
				this.write({ kind: "update", update, at });
				fold(this.state, update, at);
				this.changed();
			},
			requestPermission: async (params) => {
				const answer = await this.ask({
					type: "permission",
					id: params.toolCall.toolCallId,
					title: params.toolCall.title ?? "Allow this?",
					options: params.options.map((option) => ({
						id: option.optionId,
						name: option.name,
						kind: option.kind,
					})),
				});
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

	/** Holds `ask` until the person answers it, or the turn is cancelled. */
	private ask(asked: Asked): Promise<Answer> {
		this.settle?.({ type: "dismiss" });
		return new Promise((resolve) => {
			this.settle = resolve;
			this.set({ ask: { ...asked, at: this.now() } });
		});
	}

	/**
	 * Says `text` to the agent, once it has started, resuming the session
	 * first when it stopped. While the agent works, it joins the running turn
	 * when the agent can take it there, and otherwise waits for the turn to
	 * end.
	 */
	async prompt(text: string): Promise<void> {
		if (this.state.status === "stopped" || this.state.status === "failed") {
			await this.resume();
		}
		await this.opening;
		const words = text.trim();
		if (words === "") {
			fail("usage", "say something to the agent", { conversation: this.id });
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
		if (this.state.status === "running") {
			if (!this.steers) {
				this.queue(words);
				return;
			}
			// Said into the turn first, so a refusal leaves nothing in the thread.
			const { outcome } = await this.connection.request<{ outcome?: string }>(
				STEER,
				{
					sessionId: this.session ?? "",
					prompt: [{ type: "text", text: words }],
					_meta: { steering: { idleBehavior: "promptRequired" } },
				},
			);
			if (outcome === "injected" || outcome === "startedNewTurn") {
				const at = this.now();
				this.write({ kind: "prompt", text: words, at });
				this.state.messages.push(said(words, at));
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
				this.queue(words);
				return;
			}
		}
		this.held = false;
		const at = this.now();
		this.write({ kind: "prompt", text: words, at });
		this.state.messages.push(said(words, at));
		this.send([words]);
	}

	/** Holds `words` for when the turn ends, shown as said. */
	private queue(words: string): void {
		const at = this.now();
		this.write({ kind: "prompt", text: words, at, queued: true });
		this.state.messages.push({ ...said(words, at), queued: true });
		this.changed();
	}

	/**
	 * Starts a turn on `fresh`, with every message still queued ahead of it,
	 * as one prompt.
	 */
	private send(fresh: string[]): void {
		const waiting = this.state.messages.filter((each) => each.queued);
		if (waiting.length > 0) {
			delivered(this.state.messages);
			this.write({ kind: "sent" });
		}
		const prompt = [
			...waiting.map((each) =>
				each.parts
					.map((part) => (part.type === "text" ? part.text : ""))
					.join(""),
			),
			...fresh,
		];
		this.set({ status: "running" });
		void this.connection
			?.prompt({
				sessionId: this.session ?? "",
				prompt: [{ type: "text", text: prompt.join("\n\n") }],
			})
			.then(
				() => this.ended(null),
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
		this.set({ status: "idle", ...(error === null ? {} : { error }) });
		if (!this.held && this.state.messages.some((each) => each.queued)) {
			this.send([]);
		}
	}

	/**
	 * Takes back the `index`th queued message before the agent hears it,
	 * answering with its words, for the person to edit and send again.
	 */
	unqueue(index: number): string {
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
		return message.parts
			.map((part) => (part.type === "text" ? part.text : ""))
			.join("");
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
			await this.cancel();
			// After `cancel`, which holds the queue for a stop.
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

	/** Stops the agent's turn, leaving the conversation open for the next. */
	async cancel(): Promise<void> {
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
			value,
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
	move(task: string | null, cwd: string): void {
		this.cwd = cwd;
		this.write({ kind: "task", task, cwd });
		this.set({ task });
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

	dispose(): void {
		void this.stop();
	}

	private async put({ archived }: { archived: boolean }): Promise<void> {
		if (this.state.archived === archived) {
			return;
		}
		this.write({ kind: "archive", archived });
		this.saves.flush();
		await this.saving;
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
		this.write({ kind: "end", error });
		this.saves.flush();
		await this.saving;
		this.set({
			status: error === null ? "stopped" : "failed",
			error,
			ask: null,
		});
	}

	// TODO: webappwiz/system once `Fs` can append, so a long log is not
	// rewritten whole
	private write(entry: Entry): void {
		this.lines.push(`${JSON.stringify(entry)}\n`);
		this.saves.call(() => {
			this.saving = this.saving
				.then(() => this.fs.write(this.log, this.lines.join("")))
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

/** What the person said, `at`. */
function said(text: string, at: string | null): Message {
	return {
		role: "user",
		parts: [{ type: "text", text }],
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
): ConversationState {
	return {
		id,
		agent,
		task,
		title: null,
		name: null,
		status: "starting",
		error: null,
		messages: [],
		ask: null,
		settings: [],
		createdAt,
		archived: false,
	};
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

export type ConversationsEvents = { changed: string };

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
	private loaded = false;
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
			cwd,
			settings,
		}: { task: string | null; cwd: string; settings?: Record<string, string> },
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
				cwd,
				log: `${this.dir}/${id}.jsonl`,
				settings,
			},
			{
				fs: this.fs,
				timer: this.timer,
				clock: this.clock,
				launch: this.run,
				url: this.url,
			},
		);
		this.track(conversation);
		return conversation;
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
		conversation.events.on("changed", () =>
			this.dispatcher.dispatch("changed", conversation.id),
		);
		this.dispatcher.dispatch("changed", conversation.id);
	}

	private async load(): Promise<void> {
		if (this.loaded) {
			return;
		}
		this.loaded = true;
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
			});
			if (read !== null && !this.known.has(read.id)) {
				this.track(read);
			}
		}
	}
}

export interface ConversationsOptions {
	fs?: Fs;
	ids?: IdProvider;
	launch?: Launch;
	timer?: Timer;
	clock?: WallClock;
}
