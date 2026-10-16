import * as acp from "@agentclientprotocol/sdk";
import { Duration } from "webappwiz/time";
import {
	ASYNC_TASK_STOP,
	ASYNC_TASK_UPDATE,
	type AsyncTaskUpdate,
	asyncTasks,
	foldBackground,
	SESSION_META,
	STEER,
	steers,
} from "./acp-extensions";
import type { Agent, AgentProcess } from "./agent-process";
import type { ConversationDeps, ConversationHost } from "./conversation-host";
import { messageOf, said } from "./conversation-messages";
import type { Answer, Asked, Decision, Setting } from "./conversation-state";
import { fail } from "./exit";
import {
	configValue,
	fieldsIn,
	fold,
	result,
	settingsIn,
	starts,
} from "./fold";
import { modelOption } from "./models";
import { toolIn } from "./tool-calls";
import type { Watched } from "./watched";

/** How long an agent starting holds up the next before it may start too. */
const START_WAIT = Duration.secs(30);

/** How long a failed start waits for its process to exit, to say why it died. */
const DEATH_WAIT = Duration.secs(1);

/**
 * A conversation's side of ACP: the agent's process and the connection to
 * it, what the agent asks of this side, routed to the person, and the calls
 * the conversation makes on it. Opened anew each time the agent starts or
 * comes back, with the same session.
 */
export class AgentConnection {
	private connection: acp.ClientSideConnection | null = null;
	private process: AgentProcess | null = null;
	/** How many times `open` has run, so a start that fails late knows it is still the latest. */
	private opens = 0;
	/** The agent's session, once it has opened one. */
	private session: string | null;
	/** Settles the agent's pending ask with the person's answer. */
	private settle: ((answer: Answer) => void) | null = null;
	/** Whether the agent takes a prompt into its running turn. */
	private steering = false;
	/** Whether the agent takes images in a prompt. */
	private seeing = false;
	/** Whether the turn running is one the agent started, with no prompt to end it. */
	private unprompted = false;
	/** Whether the agent has said a turn ended, as Claude does, so one it starts can end. */
	private tells = false;
	/** The commands running, by tool call, each watched since it started. */
	private readonly watching = new Map<string, Watched>();
	/** Whether the next open loads the session, replaying it, rather than resuming it. */
	private loading: boolean;
	/** The person's words the replay has said so far, not yet logged as a prompt. */
	private heard: string | null = null;
	/** Settings picked before the session opened, set once it has. */
	private picks: Record<string, string>;
	/** The model asked for before the session opened, picked once it has. */
	private model: string | null;

	constructor(
		private readonly host: ConversationHost,
		private readonly deps: ConversationDeps,
		{
			session = null,
			loading = false,
			picks = {},
			model = null,
		}: {
			session?: string | null;
			/** Whether the first open loads `session`, replaying it, rather than resuming it. */
			loading?: boolean;
			picks?: Record<string, string>;
			model?: string | null;
		} = {},
	) {
		this.session = session;
		this.loading = loading;
		this.picks = picks;
		this.model = model;
	}

	/** The agent's pid while it runs, for the commands it left running. */
	get pid(): number | null {
		return this.process?.pid ?? null;
	}

	get sessionId(): string | null {
		return this.session;
	}

	/** Whether the agent's process is up and speaking ACP. */
	get connected(): boolean {
		return this.connection !== null;
	}

	/** Whether the agent takes a prompt into its running turn. */
	get canSteer(): boolean {
		return this.steering;
	}

	/** Whether the agent takes images in a prompt. */
	get sees(): boolean {
		return this.seeing;
	}

	/** Whether the agent is waiting on the person for an answer. */
	get asking(): boolean {
		return this.settle !== null;
	}

	/**
	 * Runs the agent and opens a session with it: the one this conversation
	 * had, when there was one, else a new one.
	 */
	async open(agent: Agent, cwd: string): Promise<void> {
		const { host } = this;
		host.set({ status: "starting", error: null, stoppedIdle: null });
		const _attempt = ++this.opens;
		const started = await this.startAlone();
		let process: AgentProcess | null = null;
		try {
			// The agent's `arbor` finds its conversation, and the server, in its
			// env, to move the conversation as it takes or lands a task. One
			// working a task another conversation added also finds that one, so
			// its `arbor add --agent` refuses: agents start agents one level deep.
			const { id, lastCaller } = host.state;
			process = this.deps.launch(agent.argv, cwd, {
				ARBOR_CONVERSATION: id,
				...(lastCaller === null || lastCaller === id
					? {}
					: { ARBOR_CALLER: lastCaller }),
				...(this.deps.url === null ? {} : { ARBOR_DEV: this.deps.url }),
			});
			const launched = process;
			this.process = launched;
			void launched.exited.then(started, started);
			void launched.exited.then((code) => {
				if (this.process === launched) {
					void host.close(
						launched.stderr().trim() ||
							`${agent.name} exited with code ${code}`,
					);
				}
			});
			const stream = acp.ndJsonStream(launched.input, launched.output);
			const connection = new acp.ClientSideConnection(() => this.client(), {
				writable: stream.writable,
				readable: asyncTasks(stream.readable),
			});
			this.connection = connection;
			const initialized = await connection.initialize({
				protocolVersion: acp.PROTOCOL_VERSION,
				// A form is how an agent asks the person something, as an MCP
				// server or a refusal's fallback does, though never a question
				// (see `SESSION_META`).
				clientCapabilities: {
					elicitation: { form: {} },
					session: { configOptions: { boolean: {} } },
					// Claude says when a command it left in the background
					// starts and ends only to a client that asks, and stops one
					// on `ASYNC_TASK_STOP`.
					_meta: {
						jetbrains: { air: { version: 1, capabilities: ["asyncTasks"] } },
					},
				},
			});
			started();
			this.steering = steers(initialized);
			this.seeing =
				initialized.agentCapabilities?.promptCapabilities?.image === true;
			// Offered only to an agent that takes them over HTTP, which they are.
			const mcpServers =
				initialized.agentCapabilities?.mcpCapabilities?.http === true
					? ((await this.deps.servers?.servers()) ?? [])
					: [];
			if (this.session === null) {
				const session = await connection.newSession({
					cwd,
					mcpServers,
					_meta: SESSION_META,
				});
				this.session = session.sessionId;
				host.log.write({ kind: "session", session: session.sessionId });
				host.state.settings = settingsIn(session.configOptions);
			} else if (this.loading) {
				const session = await connection.loadSession({
					sessionId: this.session,
					cwd,
					mcpServers,
					_meta: SESSION_META,
				});
				this.loading = false;
				this.logHeard();
				host.state.settings = settingsIn(session.configOptions);
			} else {
				const session = await connection.resumeSession({
					sessionId: this.session,
					cwd,
					mcpServers,
					_meta: SESSION_META,
				});
				host.state.settings = settingsIn(session.configOptions);
			}
			const asked =
				this.model === null
					? null
					: modelOption(host.state.settings, this.model);
			this.model = null;
			const picks =
				asked === null
					? this.picks
					: { ...this.picks, [asked.setting]: asked.value };
			this.picks = {};
			for (const [id, value] of Object.entries(picks)) {
				const setting = host.state.settings.find((each) => each.id === id);
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
					host.state.settings = settingsIn(response.configOptions);
				}
			}
			host.log.write({ kind: "settings", settings: host.state.settings });
			host.set({ status: "idle" });
		} catch (error) {
			started();
			// Left to the exit that already said why.
			if (host.state.status === "failed") {
				return;
			}
			// The connection closes as the process dies, ahead of its exit, so
			// its stderr, which says why, is waited for.
			await host.close((await this.diedSaying(process)) ?? messageOf(error));
		}
	}

	/** What `process` said on stderr if it exits within `DEATH_WAIT`, else null. */
	private async diedSaying(
		process: AgentProcess | null,
	): Promise<string | null> {
		if (process === null) {
			return null;
		}
		const { timer } = this.deps;
		let giveUp: { dispose(): void } | undefined;
		const gone = await Promise.race([
			process.exited.then(
				() => true,
				() => true,
			),
			new Promise<false>((resolve) => {
				giveUp = timer.setTimeout(() => resolve(false), DEATH_WAIT);
			}),
		]);
		giveUp?.dispose();
		return gone ? process.stderr().trim() || null : null;
	}

	/**
	 * Waits for no other agent to be starting, answering with what lets the
	 * next one start: once this one's process is up, has died, or has had
	 * `START_WAIT` to answer, so one that hangs holds up no other for long.
	 */
	private async startAlone(): Promise<() => void> {
		const { starting, timer } = this.deps;
		await starting.acquire();
		let held = true;
		const done = () => {
			if (held) {
				held = false;
				giveUp.dispose();
				void starting.release();
			}
		};
		const giveUp = timer.setTimeout(done, START_WAIT);
		return done;
	}

	/** Says `prompt` to the agent as a turn, settling with what it answered once the turn ends. */
	async prompt(
		prompt: acp.ContentBlock[],
	): Promise<acp.PromptResponse | undefined> {
		return this.connection?.prompt({ sessionId: this.session ?? "", prompt });
	}

	/**
	 * Says `prompt` into the turn the agent is running, answering with what
	 * came of it: `injected`, `startedNewTurn`, or `promptRequired` when the
	 * turn ended on the way.
	 */
	async steer(prompt: acp.ContentBlock[]): Promise<string | undefined> {
		if (this.connection === null) {
			return undefined;
		}
		const { outcome } = await this.connection.request<{ outcome?: string }>(
			STEER,
			{
				sessionId: this.session ?? "",
				prompt,
				_meta: { steering: { idleBehavior: "promptRequired" } },
			},
		);
		return outcome;
	}

	/** Stops the agent's turn, if it is connected. */
	async cancel(): Promise<void> {
		if (this.connection !== null && this.session !== null) {
			await this.connection.cancel({ sessionId: this.session });
		}
	}

	/** Stops background command `id`; the agent says it ended as it does. */
	async stopTask(id: string): Promise<void> {
		if (this.connection === null || this.session === null) {
			return;
		}
		await this.connection.extMethod(ASYNC_TASK_STOP, {
			sessionId: this.session,
			asyncTaskId: id,
		});
	}

	/**
	 * Sets `setting` to `value`, answering with the session's settings as the
	 * agent then offers them: at once while it is connected, or, while it is
	 * not, as picked for when it next opens.
	 */
	async choose(setting: Setting, value: string): Promise<Setting[]> {
		if (this.connection === null || this.session === null) {
			this.picks = { ...this.picks, [setting.id]: value };
			return this.host.state.settings.map((each) =>
				each.id === setting.id ? { ...each, current: value } : each,
			);
		}
		const response = await this.connection.setSessionConfigOption({
			sessionId: this.session,
			configId: setting.id,
			...configValue(setting, value),
		});
		return settingsIn(response.configOptions);
	}

	/** Settles the agent's pending ask, if `id` is still the one it is on. */
	answer(id: string, answer: Answer): void {
		const { host } = this;
		if (host.state.ask?.id !== id) {
			fail("not_found", `conversation ${host.state.id} is not asking ${id}`, {
				conversation: host.state.id,
			});
		}
		const settle = this.settle;
		this.settle = null;
		host.set({ ask: null });
		settle?.(answer);
	}

	/** Ends the process, dismissing whatever the agent was asking. */
	close(): void {
		this.settle?.({ type: "dismiss" });
		this.settle = null;
		this.process?.kill();
		this.process = null;
		this.connection = null;
	}

	/** What the agent may ask of this side, all of it routed to the person. */
	private client(): acp.Client {
		const { host } = this;
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
					host.log.write({ kind: "update", update });
					fold(host.state, update);
					host.changed();
					return;
				}
				const at = host.now();
				// Claude starts a turn of its own when a task it left running in
				// the background ends: a turn like any, though no prompt ends it.
				if (this.tells && host.state.status === "idle" && starts(update)) {
					this.unprompted = true;
					host.set({ status: "running", error: null });
				}
				host.log.write({ kind: "update", update, at });
				fold(host.state, update, at);
				this.watchCommand(update);
				host.changed();
				if (result(update)) {
					this.tells = true;
					if (this.unprompted) {
						this.unprompted = false;
						host.ended(null);
					}
				}
			},
			requestPermission: async (params) => {
				const { toolCall } = params;
				const title = toolCall.title ?? "Allow this?";
				// An agent may ask before it says it is making the call.
				if (toolIn(host.state, toolCall.toolCallId) === null) {
					const at = host.now();
					const update: acp.SessionUpdate = {
						sessionUpdate: "tool_call",
						toolCallId: toolCall.toolCallId,
						title,
						kind: toolCall.kind ?? undefined,
						rawInput: toolCall.rawInput,
						locations: toolCall.locations ?? undefined,
						_meta: toolCall._meta,
					};
					host.log.write({ kind: "update", update, at });
					fold(host.state, update, at);
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
			// Left out of the log: its commands end with its process, so one
			// read back has none running.
			extNotification: async (method, params) => {
				if (method === ASYNC_TASK_UPDATE && !this.loading) {
					foldBackground(host.state, params.update as AsyncTaskUpdate);
					host.changed();
				}
			},
		};
	}

	/**
	 * Watches each command the agent runs from when it starts, and keeps what
	 * it did to git that it should not have once it ends.
	 */
	private watchCommand(update: acp.SessionUpdate): void {
		const { host } = this;
		const { watch } = this.deps;
		if (
			watch === null ||
			host.cwd === null ||
			(update.sessionUpdate !== "tool_call" &&
				update.sessionUpdate !== "tool_call_update")
		) {
			return;
		}
		const tool = toolIn(host.state, update.toolCallId);
		if (tool?.kind !== "execute") {
			return;
		}
		const watched = this.watching.get(tool.id);
		if (tool.status !== "completed" && tool.status !== "failed") {
			if (watched === undefined) {
				this.watching.set(tool.id, watch.command(host.cwd));
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
					host.log.write({ kind: "flags", tool: tool.id, flags });
					host.changed();
				}
			})
			// Git it cannot read is nothing to flag.
			.catch(() => {});
	}

	/** Logs the person's words the replay has said, as one prompt. */
	private logHeard(): void {
		const text = this.heard?.trim() ?? "";
		this.heard = null;
		if (text === "") {
			return;
		}
		this.host.log.write({ kind: "prompt", text });
		this.host.state.messages.push(said(text, null));
		this.host.changed();
	}

	/** Keeps how the person answered the permission asked for tool call `id`. */
	private decided(
		id: string,
		options: acp.PermissionOption[],
		answer: Answer,
	): void {
		const { host } = this;
		const tool = toolIn(host.state, id);
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
			at: host.now(),
		};
		tool.decision = decision;
		host.log.write({ kind: "decision", tool: id, decision });
		host.changed();
	}

	/** Holds `asked` until the person answers it, or the turn is cancelled. */
	private ask(asked: Asked): Promise<Answer> {
		this.settle?.({ type: "dismiss" });
		return new Promise((resolve) => {
			this.settle = resolve;
			this.host.set({ ask: { ...asked, at: this.host.now() } });
		});
	}
}
