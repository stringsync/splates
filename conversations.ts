import * as acp from "@agentclientprotocol/sdk";
import type { Resource } from "webappwiz/disposable";
import { Dispatcher, type Eventful } from "webappwiz/events";
import { type IdProvider, UuidProvider } from "webappwiz/id";
import { type Fs, NodeFs } from "webappwiz/system";
import { Duration, SystemTimer, Throttler, type Timer } from "webappwiz/time";
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

/** One piece of what someone in a conversation said or did. */
export type Part =
	| { type: "text"; text: string }
	| { type: "thought"; text: string }
	| {
			type: "tool";
			id: string;
			title: string;
			status: "pending" | "in_progress" | "completed" | "failed";
	  };

/** One turn's worth of words, the person's or the agent's. */
export interface Message {
	role: "user" | "agent";
	parts: Part[];
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
	| { kind: "prompt"; text: string }
	| { kind: "update"; update: acp.SessionUpdate }
	| { kind: "end"; error: string | null };

/**
 * Folds one ACP update into the messages: text runs on in the message it
 * started, and a tool call is one part whose status moves along.
 */
export function fold(
	state: ConversationState,
	update: acp.SessionUpdate,
): void {
	switch (update.sessionUpdate) {
		case "agent_message_chunk":
		case "agent_thought_chunk": {
			if (update.content.type !== "text") {
				return;
			}
			const type =
				update.sessionUpdate === "agent_message_chunk" ? "text" : "thought";
			const parts = agentTurn(state).parts;
			const last = parts.at(-1);
			if (last?.type === type) {
				last.text += update.content.text;
			} else {
				parts.push({ type, text: update.content.text });
			}
			return;
		}
		case "tool_call":
			agentTurn(state).parts.push({
				type: "tool",
				id: update.toolCallId,
				title: update.title,
				status: update.status ?? "pending",
			});
			return;
		case "tool_call_update": {
			const part = state.messages
				.flatMap((message) => message.parts)
				.find((each) => each.type === "tool" && each.id === update.toolCallId);
			if (part?.type === "tool") {
				part.title = update.title ?? part.title;
				part.status = update.status ?? part.status;
			}
			return;
		}
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

/** The agent's message at the end, started if the person spoke last. */
function agentTurn(state: ConversationState): Message {
	const last = state.messages.at(-1);
	if (last?.role === "agent") {
		return last;
	}
	const turn: Message = { role: "agent", parts: [] };
	state.messages.push(turn);
	return turn;
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

	/** A conversation as its log left it: stopped, whatever it was doing. */
	static async read(
		log: string,
		{
			fs,
			timer,
			agents,
			launch: run,
			url,
		}: {
			fs: Fs;
			timer: Timer;
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
					role: "user",
					parts: [{ type: "text", text: entry.text }],
				});
			} else if (entry.kind === "update") {
				fold(state, entry.update);
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
			launch: run,
			url,
		}: { fs: Fs; timer: Timer; launch: Launch; url: string | null },
	): Promise<Conversation> {
		const conversation = new Conversation(
			blank(id, agent.id, task, new Date().toISOString()),
			log,
			fs,
			timer,
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
			await connection.initialize({
				protocolVersion: acp.PROTOCOL_VERSION,
				// A form is how an agent asks the person a question, Claude's
				// AskUserQuestion among them; without it the agent asks in prose.
				clientCapabilities: { elicitation: { form: {} } },
			});
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
				this.write({ kind: "update", update });
				fold(this.state, update);
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
			this.set({ ask: { ...asked, at: new Date().toISOString() } });
		});
	}

	/**
	 * Says `text` to the agent, once it has started, resuming the session
	 * first when it stopped; refused while the agent is still answering the
	 * last.
	 */
	async prompt(text: string): Promise<void> {
		if (this.state.status === "stopped" || this.state.status === "failed") {
			await this.resume();
		}
		await this.opening;
		if (this.state.status !== "idle" || this.connection === null) {
			fail(
				"usage",
				`conversation ${this.id} is ${this.state.status}: wait for the agent, or cancel its turn`,
				{ conversation: this.id },
			);
		}
		const words = text.trim();
		if (words === "") {
			fail("usage", "say something to the agent", { conversation: this.id });
		}
		this.write({ kind: "prompt", text: words });
		this.state.messages.push({
			role: "user",
			parts: [{ type: "text", text: words }],
		});
		this.set({ status: "running" });
		void this.connection
			.prompt({
				sessionId: this.session ?? "",
				prompt: [{ type: "text", text: words }],
			})
			.then(
				() => {
					if (this.state.status === "running") {
						this.set({ status: "idle" });
					}
				},
				(error: unknown) => {
					if (this.state.status === "running") {
						this.set({ status: "idle", error: messageOf(error) });
					}
				},
			);
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
			{ fs: this.fs, timer: this.timer, launch: this.run, url: this.url },
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
}
