// scry-ignore-file compact-files: ACP requests, replay, asks, and reattachment share one connection state machine.
import * as acp from "@agentclientprotocol/sdk";
import { Disposer } from "webappwiz/disposable";
import { Duration } from "webappwiz/time";
import {
	ASYNC_TASK_STOP,
	ASYNC_TASK_UPDATE,
	type AsyncTaskUpdate,
	asyncTasks,
	finalAnswer,
	foldBackground,
	SESSION_META,
	STEER,
	steers,
} from "./acp-extensions";
import { agentError } from "./agent-errors";
import type { Agent, AgentProcess, ProcessHandle } from "./agent-process";
import { AgentStream } from "./agent-stream";
import type { ConversationDeps, ConversationHost } from "./conversation-host";
import type { Live } from "./conversation-log";
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
import { parentOf, toolIn } from "./tool-calls";
import type { Watched } from "./watched";

/** How long an agent starting holds up the next before it may start too. */
const START_WAIT = Duration.secs(30);

/** How long a failed start waits for its process to exit, to say why it died. */
const DEATH_WAIT = Duration.secs(1);

/** The options of a permission the agent asks, as the state keeps them. */
type Options = Extract<Asked, { type: "permission" }>["options"];

/**
 * A conversation's side of ACP: the agent's process and the connection to
 * it, what the agent asks of this side, routed to the person, and the calls
 * the conversation makes on it. Opened anew each time the agent starts or
 * comes back, with the same session, or reattached to a process a worker
 * kept running while the coordinator restarted.
 */
export class AgentConnection {
	private connection: acp.ClientSideConnection | null = null;
	private process: AgentProcess | null = null;
	private stream: AgentStream | null = null;
	/** What listens on the stream and the log while they are up. */
	private listening: Disposer | null = null;
	/** How many times `open` has run, so a start that fails late knows it is still the latest. */
	private opens = 0;
	/** The agent's session, once it has opened one. */
	private session: string | null;
	/** Settles the agent's pending ask with the person's answer. */
	private settle: ((answer: Answer) => void) | null = null;
	/** Whether the agent takes a prompt into its running turn. */
	private steering = false;
	/**
	 * Whether the running turn is on its final answer: a prompt steered in
	 * now may find it ended, and the agent start a turn of its own for it.
	 */
	private finishing = false;
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
	/** Recovery loads replay history already in the log. */
	private suppressReplay = false;
	/** Settings picked before the session opened, set once it has. */
	private picks: Record<string, string>;
	/** The model asked for before the session opened, picked once it has. */
	private model: string | null;
	private sessionCwd: string | null;

	constructor(
		private readonly host: ConversationHost,
		private readonly deps: ConversationDeps,
		{
			session = null,
			loading = false,
			picks = {},
			model = null,
			sessionCwd = null,
		}: {
			session?: string | null;
			/** Whether the first open loads `session`, replaying it, rather than resuming it. */
			loading?: boolean;
			picks?: Record<string, string>;
			model?: string | null;
			sessionCwd?: string | null;
		} = {},
	) {
		this.session = session;
		this.loading = loading;
		this.picks = picks;
		this.model = model;
		this.sessionCwd = sessionCwd;
	}

	/** The agent's pid while it runs, for the commands it left running. */
	get pid(): number | null {
		return this.process?.pid ?? null;
	}

	/** What takes the agent's process back after a restart; null while none could. */
	get handle(): ProcessHandle | null {
		return this.connection === null ? null : (this.process?.handle ?? null);
	}

	get sessionId(): string | null {
		return this.session;
	}

	/** Whether the agent's process is up and speaking ACP. */
	get connected(): boolean {
		return this.connection !== null;
	}

	/** Whether the agent takes a prompt into its running turn, as it stands. */
	get canSteer(): boolean {
		return this.steering && !this.finishing;
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
		const previous = host.state.settings;
		const started = await this.startAlone();
		let process: AgentProcess | null = null;
		try {
			if (agent.id === "opencode" && this.session !== null) {
				const original = this.sessionCwd;
				if (original === null || !(await this.deps.fs.exists(original))) {
					throw new Error(
						`OpenCode cannot recover this session: original directory ${original ?? "unknown"} is unavailable. Restore it or explicitly start a new conversation.`,
					);
				}
				cwd = original;
			}
			// The agent's `arbor` finds its conversation, and the server, in its
			// env, to move the conversation as it takes or lands a task. One
			// working a task another conversation added also finds that one, so
			// its `arbor add --agent` refuses: agents start agents one level deep.
			// One a lane's orchestrator started finds it as the one that started
			// it, not one it reports to: it answers to the person.
			const { id, lastCaller, startedBy } = host.state;
			// Reset the log cursor so a replacement process can acknowledge its own frames.
			host.log.heard(0);
			process = this.deps.launcher.launch(agent.argv, cwd, {
				ARBOR_CONVERSATION: id,
				...(startedBy !== null
					? { ARBOR_STARTED_BY: startedBy }
					: lastCaller === null || lastCaller === id
						? {}
						: { ARBOR_CALLER: lastCaller }),
				...(this.deps.url === null ? {} : { ARBOR_DEV: this.deps.url }),
			});
			const launched = process;
			void launched.exited.then(started, started);
			const connection = this.attach(agent, launched, {});
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
			if (initialized.protocolVersion !== acp.PROTOCOL_VERSION) {
				throw new Error(
					`Unsupported ACP protocol version ${initialized.protocolVersion}; expected ${acp.PROTOCOL_VERSION}.`,
				);
			}
			started();
			this.steering = steers(initialized);
			this.finishing = false;
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
				this.sessionCwd = cwd;
				host.log.write({ kind: "session", session: session.sessionId, cwd });
				host.state.settings = settingsIn(session.configOptions);
			} else if (
				this.loading ||
				initialized.agentCapabilities?.sessionCapabilities?.resume == null
			) {
				if (initialized.agentCapabilities?.loadSession !== true) {
					throw new Error(
						`${agent.name} cannot recover this session: it advertises neither resume nor load. Start a new conversation explicitly.`,
					);
				}
				this.suppressReplay = !this.loading;
				const session = await connection.loadSession({
					sessionId: this.session,
					cwd,
					mcpServers,
					_meta: SESSION_META,
				});
				this.loading = false;
				this.suppressReplay = false;
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
					: modelOption(
							host.state.settings,
							this.model,
							agent.id === "opencode",
						);
			if (this.model !== null && asked === null) {
				throw new Error(
					`Requested model '${this.model}' is not offered by ${agent.name}; no prompt was sent.`,
				);
			}
			const picks = {
				...Object.fromEntries(
					previous
						.filter((each) => each.category === "model" || each.id === "model")
						.map((each) => [each.id, each.current]),
				),
				...this.picks,
				...(asked === null ? {} : { [asked.setting]: asked.value }),
			};
			this.picks = picks;
			for (const [id, value] of Object.entries(picks)) {
				const setting = host.state.settings.find((each) => each.id === id);
				const isModel =
					id === "model" ||
					setting?.category === "model" ||
					previous.some((each) => each.id === id && each.category === "model");
				if (isModel) {
					this.model = value;
					host.log.write({ kind: "model-request", model: value });
				}
				if (
					isModel &&
					!setting?.options.some((option) => option.value === value)
				) {
					throw new Error(
						`Requested model '${value}' is no longer offered; no prompt was sent.`,
					);
				}
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
				if (
					isModel &&
					host.state.settings.find((each) => each.id === id)?.current !== value
				) {
					throw new Error(
						`Agent did not confirm requested model '${value}'; no prompt was sent.`,
					);
				}
			}
			this.picks = {};
			host.log.write({ kind: "settings", settings: host.state.settings });
			// On a worker, the process outlives a restart from here on: the
			// log says what to take back and what the agent can do.
			if (launched.handle !== null) {
				host.log.write({
					kind: "launched",
					handle: launched.handle,
					steers: this.steering,
					sees: this.seeing,
				});
			}
			host.set({ status: "idle" });
		} catch (error) {
			started();
			this.suppressReplay = false;
			// Left to the exit that already said why.
			if (host.state.status === "failed") {
				return;
			}
			// The connection closes as the process dies, ahead of its exit, so
			// its stderr, which says why, is waited for.
			await host.close(
				(await this.diedSaying(process)) ?? agentError(messageOf(error)),
			);
		}
	}

	/**
	 * Speaks ACP again to `process`, which a worker kept running while the
	 * coordinator restarted, where the log left off: `live` says what was in
	 * flight. A late answer to the prompt it was on ends the turn, and the
	 * question it was asking is answered on the request it came in.
	 */
	reattach(agent: Agent, process: AgentProcess, live: Live): void {
		const { host } = this;
		this.attach(agent, process, { base: live.lastId + 1 });
		this.steering = live.steers;
		this.seeing = live.sees;
		this.tells = live.tells;
		this.unprompted = host.state.status === "running" && live.prompt === null;
		const stream = this.stream;
		if (stream !== null) {
			this.listening?.defer(
				stream.events.on("stale", (response) => {
					if (response.id !== live.prompt) {
						return;
					}
					if ("error" in response) {
						host.ended(response.error.message);
						return;
					}
					const { usage } = response.result as acp.PromptResponse;
					if (usage != null) {
						host.log.write({ kind: "usage", usage });
					}
					host.ended(null);
				}),
			);
		}
		if (live.ask !== null && live.ask.rpc !== null && stream !== null) {
			const { rpc, ask } = live.ask;
			this.settle = (answer) => {
				if (ask.type === "permission") {
					this.decided(ask.id, ask.options, answer, ask.at);
				}
				void stream.respond(rpc, { result: answered(ask, answer) });
			};
		} else if (host.state.ask !== null) {
			host.log.write({ kind: "ask", ask: null });
			host.state.ask = null;
		}
		host.changed();
	}

	/**
	 * Lets go of the process without ending it, for a coordinator started
	 * again to take back, once the stream has handed over whole frames only:
	 * the log flushed after this says where it stopped.
	 */
	async detach(): Promise<void> {
		await this.stream?.detach();
		this.listening?.dispose();
		this.listening = null;
		this.stream = null;
		this.process = null;
		this.connection = null;
	}

	/**
	 * Opens ACP over `process`, which from here is the one this conversation
	 * runs: its frames stamp the log, its exit closes the conversation, and
	 * the worker is acked for each frame once the log holds it.
	 */
	private attach(
		agent: Agent,
		process: AgentProcess,
		opts: { base?: number },
	): acp.ClientSideConnection {
		const { host } = this;
		this.listening?.dispose();
		this.process = process;
		void process.exited.then((code) => {
			if (this.process !== process) {
				return;
			}
			// One taken back that the worker turns out not to hold any more
			// stops as an idle agent does, when no turn was on it.
			const lost = opts.base !== undefined && host.state.status !== "running";
			void host.close(
				lost
					? null
					: agentError(process.stderr()).trim() ||
							`${agent.name} exited with code ${code}`,
			);
		});
		const stream = new AgentStream(process, opts);
		this.stream = stream;
		const listening = new Disposer();
		this.listening = listening;
		// Only a process a worker can hand back after a restart has its
		// frames and requests written down: one that ends with this process
		// leaves nothing to take back.
		if (process.handle !== null) {
			listening.defer(
				stream.events.on("handling", (seq) => host.log.heard(seq)),
			);
			listening.defer(
				stream.events.on("request", ({ id, method }) =>
					host.log.write({ kind: "request", id, method }),
				),
			);
			// Acked only for what the file holds of every frame up to it, so a
			// restart replays from where the log leaves off.
			let acked = 0;
			const ack = () => {
				const through = Math.min(host.log.savedThrough, stream.dispatched);
				if (through > acked) {
					acked = through;
					process.ack(through);
				}
			};
			listening.defer(stream.events.on("dispatched", ack));
			listening.defer(host.log.events.on("saved", ack));
		}
		const connection = new acp.ClientSideConnection(() => this.client(), {
			writable: stream.writable,
			readable: asyncTasks(stream.readable),
		});
		this.connection = connection;
		void connection.closed.then(() => {
			if (this.connection === connection && host.state.status !== "starting") {
				void host.close(
					`${agent.name} ACP connection closed; retry explicitly to recover the session.`,
				);
			}
		});
		return connection;
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
		return gone ? agentError(process.stderr()).trim() || null : null;
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
		this.validateModel();
		this.finishing = false;
		return this.connection?.prompt({ sessionId: this.session ?? "", prompt });
	}

	/** A stale or substituted choice must never reach a prompt or steering call. */
	private validateModel(): void {
		if (this.model !== null) {
			const selected = modelOption(this.host.state.settings, this.model, true);
			if (
				selected === null ||
				this.host.state.settings.find((each) => each.id === selected.setting)
					?.current !== this.model
			) {
				throw new Error(
					`Requested model '${this.model}' is not confirmed; no prompt was sent.`,
				);
			}
		}
	}

	/**
	 * Says `prompt` into the turn the agent is running, answering with what
	 * came of it: `injected`, `startedNewTurn`, or `promptRequired` when the
	 * turn ended on the way.
	 */
	async steer(prompt: acp.ContentBlock[]): Promise<string | undefined> {
		this.validateModel();
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
		// An agent that starts a turn of its own rather than answer
		// `promptRequired`, as Codex does, is steered no more unless it says
		// when such a turn ends, as Claude does: arbor would show it idle
		// while it works, and put the next prompt on top of that turn.
		if (outcome === "startedNewTurn" && !this.tells) {
			this.steering = false;
		}
		return outcome;
	}

	/** Stops the agent's turn, if it is connected. */
	async cancel(): Promise<void> {
		this.settled({ type: "dismiss" });
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
		if (setting.category === "model" || setting.id === "model") {
			this.model = value;
			this.host.log.write({ kind: "model-request", model: value });
		}
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
		const settings = settingsIn(response.configOptions);
		if (
			(setting.category === "model" || setting.id === "model") &&
			settings.find((each) => each.id === setting.id)?.current !== value
		) {
			await this.host.close(
				`Agent did not confirm requested model '${value}'; no prompt was sent.`,
			);
			throw new Error(`Agent did not confirm requested model '${value}'`);
		}
		return settings;
	}

	/** Settles the agent's pending ask, if `id` is still the one it is on. */
	answer(id: string, answer: Answer): void {
		const { host } = this;
		if (host.state.ask?.id !== id) {
			fail("not_found", `conversation ${host.state.id} is not asking ${id}`, {
				conversation: host.state.id,
			});
		}
		this.settled(answer);
	}

	// scry-ignore resources-are-disposable: closes one process; this reusable connection keeps session and requested settings for reopening.
	/** Ends the process, dismissing whatever the agent was asking. */
	close(): void {
		this.settled({ type: "dismiss" });
		this.listening?.dispose();
		this.listening = null;
		this.stream = null;
		this.process?.kill();
		this.process = null;
		this.connection = null;
	}

	/** What the agent may ask of this side, all of it routed to the person. */
	private client(): acp.Client {
		const { host } = this;
		return {
			sessionUpdate: async ({ update }) => {
				if (this.suppressReplay) {
					return;
				}
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
					this.finishing = false;
					host.set({ status: "running", error: null });
				}
				if (finalAnswer(update) && parentOf(update) === null) {
					this.finishing = true;
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
				if (this.suppressReplay) {
					return { outcome: { outcome: "cancelled" } };
				}
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
				const askedAt = host.now();
				const asked: Asked = {
					type: "permission",
					id: toolCall.toolCallId,
					title,
					options: params.options.map((option) => ({
						id: option.optionId,
						name: option.name,
						kind: option.kind,
					})),
				};
				const answer = await this.ask(asked, askedAt);
				this.decided(toolCall.toolCallId, asked.options, answer, askedAt);
				return permitted(answer);
			},
			createElicitation: async (params) => {
				if (this.suppressReplay || params.mode !== "form") {
					return { action: "decline" };
				}
				const asked: Asked = {
					type: "question",
					id: crypto.randomUUID(),
					message: params.message,
					fields: fieldsIn(params.requestedSchema),
				};
				return elicited(await this.ask(asked));
			},
			// Kept, since on a worker its commands outlive a restart; a log
			// read back with its process gone has none running.
			extNotification: async (method, params) => {
				if (
					method === ASYNC_TASK_UPDATE &&
					!this.loading &&
					!this.suppressReplay
				) {
					const update = params.update as AsyncTaskUpdate;
					host.log.write({ kind: "background", update });
					foldBackground(host.state, update);
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
		options: Options,
		answer: Answer,
		askedAt: string,
	): void {
		const { host } = this;
		const tool = toolIn(host.state, id);
		if (tool === null) {
			return;
		}
		const picked =
			answer.type === "permission"
				? options.find((option) => option.id === answer.option)
				: undefined;
		const decision: Decision = {
			askedAt,
			option:
				picked === undefined ? null : { name: picked.name, kind: picked.kind },
			at: host.now(),
		};
		tool.decision = decision;
		host.log.write({ kind: "decision", tool: id, decision });
		host.changed();
	}

	/**
	 * Holds `asked` until the person answers it, or the turn is cancelled,
	 * logged with the request it came in, so a coordinator started again can
	 * answer it there.
	 */
	private ask(asked: Asked, at = this.host.now()): Promise<Answer> {
		this.settled({ type: "dismiss" });
		return new Promise((resolve) => {
			this.settle = resolve;
			const ask = { ...asked, at };
			this.host.log.write({
				kind: "ask",
				rpc: this.stream?.asking ?? null,
				ask,
			});
			this.host.set({ ask });
		});
	}

	/** Settles the pending ask, if any, with `answer`, and logs that it is answered. */
	private settled(answer: Answer): void {
		const settle = this.settle;
		this.settle = null;
		if (settle === null && this.host.state.ask === null) {
			return;
		}
		this.host.log.write({ kind: "ask", ask: null });
		this.host.set({ ask: null });
		settle?.(answer);
	}
}

/** What the agent hears back for `asked`, as the person answered it. */
function answered(
	asked: Asked,
	answer: Answer,
): acp.RequestPermissionResponse | acp.CreateElicitationResponse {
	return asked.type === "permission" ? permitted(answer) : elicited(answer);
}

function permitted(answer: Answer): acp.RequestPermissionResponse {
	return answer.type === "permission"
		? { outcome: { outcome: "selected", optionId: answer.option } }
		: { outcome: { outcome: "cancelled" } };
}

function elicited(answer: Answer): acp.CreateElicitationResponse {
	return answer.type === "question"
		? { action: "accept", content: answer.values }
		: { action: "decline" };
}
