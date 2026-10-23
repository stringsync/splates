import * as acp from "@agentclientprotocol/sdk";
import type { FakeChild, FakePs } from "webappwiz/system/testing";
import { type AgentProcess, framed } from "./process";

/** What the agent does with each prompt, given the connection back to splates. */
export type Turn = (
	client: acp.AgentSideConnection,
	session: string,
	text: string,
) => Promise<acp.StopReason>;

/**
 * An ACP agent in this process, joined to the conversation by two pipes in
 * place of a child's stdio, and played by `turn`.
 */
export class FakeAgent {
	turn: Turn = async () => "end_turn";
	cancelled = 0;
	/** The sessions resumed, by id, in order. */
	resumed: string[] = [];
	/**
	 * What `_session/steering` answers, or null for an agent that does not
	 * offer it, the default: `startedNewTurn` as Codex does when it finds no
	 * turn, whatever splates asked, and `failed` as it does on an error.
	 */
	steering: "injected" | "promptRequired" | "startedNewTurn" | "failed" | null =
		null;
	/** What was steered into a turn, in order. */
	steered: string[] = [];
	/** What it does before it answers a steer, as ending the turn it would steer into. */
	beforeSteer: () => Promise<void> = async () => {};
	/** Whether it offers its session list to subscribe to, as Codex does. */
	lists = false;
	/** The working directories its session list was subscribed for, in order. */
	subscribed: string[] = [];
	/** What splates said it can take, as it started the last process. */
	capabilities: acp.ClientCapabilities | null = null;
	/** The background commands stopped, by id, in order. */
	stoppedBackground: string[] = [];
	/** Whether it says it takes images in a prompt. */
	sees = false;
	/** The tokens it says each turn used; none, the default, says nothing. */
	usage: acp.Usage | null = null;
	/**
	 * The sessions it holds from before, as its CLI would, to list and load;
	 * none, the default, for an agent that does not offer either.
	 */
	held: (acp.SessionInfo & { replay: acp.SessionUpdate[] })[] | null = null;
	/** The sessions loaded, by id, in order. */
	loaded: string[] = [];
	/** The `_meta` each session was opened, loaded or resumed with, in order. */
	opened: unknown[] = [];
	/** Whether it takes MCP servers over HTTP, as Claude's adapter does. */
	http = false;
	/** The MCP servers each session was opened, loaded or resumed with, in order. */
	mcp: acp.McpServer[][] = [];
	/** Every prompt it was sent, block by block, in order. */
	prompts: acp.ContentBlock[][] = [];
	/** The settings set, in order. */
	chosen: { configId: string; value: unknown }[] = [];
	options: acp.SessionConfigOption[] = [
		{
			id: "mode",
			name: "Mode",
			category: "mode",
			type: "select",
			currentValue: "ask",
			options: [
				{ value: "ask", name: "Ask" },
				{ value: "auto", name: "Auto" },
			],
		},
		{
			id: "model",
			name: "Model",
			category: "model",
			type: "select",
			currentValue: "big",
			options: [
				{ value: "big", name: "Big" },
				{ value: "small", name: "Small", description: "Fast" },
			],
		},
		{
			id: "fast",
			name: "Fast mode",
			category: "model_config",
			type: "boolean",
			currentValue: false,
		},
	];
	/** Negotiated resume support; absent capabilities must never imply it. */
	resumes = true;
	protocolVersion = acp.PROTOCOL_VERSION;
	disconnect: () => void = () => {};
	/** Simulate an agent refusing to apply a model choice. */
	ignoreChoices = false;
	/** What each start's `initialize` waits on; null, the default, answers at once. */
	hold: Promise<void> | null = null;
	/** What each new session waits on before it opens; null, the default, opens at once. */
	holdSession: Promise<void> | null = null;
	/** What the next new session fails with, as Claude's adapter does when its binary dies. */
	refuseSession: acp.RequestError | null = null;
	/** How many starts to come die before answering `initialize`. */
	dying = 0;
	stderr = "fake agent fell over";
	launched: { argv: string[]; cwd: string; env: Record<string, string> }[] = [];
	killed = 0;
	/** The pid each process it launches says it has. */
	pid: number | null = null;
	private exit: (code: number) => void = () => {};

	launch = (
		argv: string[],
		cwd: string,
		env: Record<string, string>,
	): AgentProcess => {
		this.launched.push({ argv, cwd, env });
		const toAgent = new TransformStream<Uint8Array, Uint8Array>();
		const toClient = new TransformStream<Uint8Array, Uint8Array>({
			start: (controller) => {
				this.disconnect = () => controller.terminate();
			},
		});
		new acp.AgentSideConnection(
			(client) => this.agent(client),
			acp.ndJsonStream(toClient.writable, toAgent.readable),
		);
		const exited = new Promise<number>((resolve) => {
			this.exit = resolve;
		});
		return {
			pid: this.pid,
			input: toAgent.writable,
			output: framed(toClient.readable),
			ack: () => {},
			handle: null,
			stderr: () => this.stderr,
			exited,
			kill: () => {
				this.killed++;
			},
		};
	};

	/** Dies as a crashed agent would, on its own. */
	crash(): void {
		this.exit(1);
	}

	/** Says `update` outside any turn, as Claude does of a background command. */
	async say(update: acp.SessionUpdate): Promise<void> {
		await this.client?.sessionUpdate({ sessionId: "s1", update });
	}

	/**
	 * Says on its session list that session `s1` is in `state`, its last turn
	 * ended at `endedAt`, as Codex does as a turn starts and ends.
	 */
	async list(
		state: "running" | "idle" | "error",
		endedAt?: string,
	): Promise<void> {
		await this.client?.extNotification("_session/list/changes", {
			subscriptionId: "list-1",
			sessions: [
				{
					sessionId: "s1",
					cwd: this.subscribed.at(-1) ?? "/",
					_meta: {
						jetbrains: {
							air: {
								state,
								...(endedAt === undefined ? {} : { lastTurnEndedAt: endedAt }),
							},
						},
					},
				},
			],
		});
	}

	private client: acp.AgentSideConnection | null = null;

	private agent(client: acp.AgentSideConnection): acp.Agent {
		this.client = client;
		return {
			initialize: async ({ clientCapabilities }) => {
				if (this.dying > 0) {
					this.dying--;
					this.exit(1);
					throw new Error("ACP connection closed");
				}
				await this.hold;
				this.capabilities = clientCapabilities ?? null;
				return {
					protocolVersion: this.protocolVersion,
					agentCapabilities: {
						...(this.http ? { mcpCapabilities: { http: true } } : {}),
						...(this.sees ? { promptCapabilities: { image: true } } : {}),
						loadSession: this.held !== null,
						sessionCapabilities: {
							...(this.resumes ? { resume: {} } : {}),
							...(this.held === null ? {} : { list: {} }),
						},
					},
					_meta: {
						...(this.steering === null
							? {}
							: { steering: { supported: true } }),
						...(this.lists
							? {
									jetbrains: {
										air: { version: 1, capabilities: ["sessionListSubscribe"] },
									},
								}
							: {}),
					},
				};
			},
			extMethod: async (method, params) => {
				// Stopped, it says so, as Claude's adapter does.
				if (method === "_session/async_task/stop") {
					const id = String(params.asyncTaskId);
					this.stoppedBackground.push(id);
					await client.sessionUpdate({
						sessionId: String(params.sessionId),
						update: backgroundEnded(id, "stopped"),
					});
					return { stopped: true };
				}
				if (method === "_session/list/subscribe" && this.lists) {
					this.subscribed.push(String(params.cwd));
					return { subscriptionId: "list-1" };
				}
				if (method !== "_session/steering" || this.steering === null) {
					throw acp.RequestError.methodNotFound(method);
				}
				const prompt = params.prompt as acp.ContentBlock[];
				await this.beforeSteer();
				if (
					this.steering === "injected" ||
					this.steering === "startedNewTurn"
				) {
					this.steered.push(
						prompt
							.map((block) => (block.type === "text" ? block.text : ""))
							.join(""),
					);
				}
				return { outcome: this.steering };
			},
			newSession: async ({ _meta, mcpServers }) => {
				await this.holdSession;
				const refused = this.refuseSession;
				if (refused !== null) {
					this.refuseSession = null;
					throw refused;
				}
				this.opened.push(_meta);
				this.mcp.push(mcpServers);
				return { sessionId: "s1", configOptions: this.options };
			},
			listSessions: async ({ cwd }) => ({
				sessions: (this.held ?? [])
					.filter((each) => cwd == null || each.cwd === cwd)
					.map(({ replay: _, ...info }) => info),
			}),
			loadSession: async ({ sessionId, _meta, mcpServers }) => {
				this.opened.push(_meta);
				this.mcp.push(mcpServers);
				const session = this.held?.find((each) => each.sessionId === sessionId);
				if (session === undefined) {
					throw acp.RequestError.resourceNotFound(sessionId);
				}
				this.loaded.push(sessionId);
				for (const update of session.replay) {
					await client.sessionUpdate({ sessionId, update });
				}
				return { configOptions: this.options };
			},
			resumeSession: async ({ sessionId, _meta, mcpServers }) => {
				this.opened.push(_meta);
				this.mcp.push(mcpServers ?? []);
				this.resumed.push(sessionId);
				return { configOptions: this.options };
			},
			authenticate: async () => ({}),
			setSessionConfigOption: async ({ configId, value }) => {
				this.chosen.push({ configId, value });
				this.options = this.options.map((option) =>
					option.id === configId && !this.ignoreChoices
						? ({
								...option,
								currentValue:
									typeof value === "boolean" ? value : String(value),
							} as acp.SessionConfigOption)
						: option,
				);
				return { configOptions: this.options };
			},
			prompt: async ({ sessionId, prompt }) => {
				this.prompts.push(prompt);
				return {
					stopReason: await this.turn(
						client,
						sessionId,
						prompt
							.map((block) => (block.type === "text" ? block.text : ""))
							.join(""),
					),
					usage: this.usage,
				};
			},
			cancel: async () => {
				this.cancelled++;
			},
		};
	}
}

/** What the person said, as an agent replays it. */
export function heard(text: string): acp.SessionUpdate {
	return {
		sessionUpdate: "user_message_chunk",
		content: { type: "text", text },
	};
}

export function say(text: string): acp.SessionUpdate {
	return {
		sessionUpdate: "agent_message_chunk",
		content: { type: "text", text },
	};
}

/**
 * Claude's adapter saying it left a command running in the background as
 * `id`, started by tool call `tool`: a draft the SDK's types leave out.
 */
export function backgroundStarted(
	id: string,
	description: string,
	tool: string,
	taskType = "shell",
	output?: string,
): acp.SessionUpdate {
	return {
		sessionUpdate: "async_task_spawned",
		asyncTaskId: id,
		name: description,
		taskType,
		description,
		showInTranscript: true,
		canStop: true,
		toolCallId: tool,
		...(output === undefined ? {} : { outputFilePath: output }),
	} as unknown as acp.SessionUpdate;
}

/** Claude's adapter saying background command `id` ended as `state`. */
export function backgroundEnded(
	id: string,
	state: "completed" | "failed" | "stopped",
): acp.SessionUpdate {
	return {
		sessionUpdate: "async_task_state_update",
		asyncTaskId: id,
		state,
	} as unknown as acp.SessionUpdate;
}

/** Claude's adapter saying where background command `id` writes its output. */
export function backgroundWrites(
	id: string,
	output: string,
): acp.SessionUpdate {
	return {
		sessionUpdate: "async_task_progress",
		asyncTaskId: id,
		outputFilePath: output,
	} as unknown as acp.SessionUpdate;
}

/** Everything `process` prints to stdout, once it closes it, as text. */
export async function printed(
	process: Pick<AgentProcess, "output">,
): Promise<string> {
	const decoder = new TextDecoder();
	let text = "";
	for await (const frame of process.output) {
		text += decoder.decode(frame.bytes, { stream: true });
	}
	return text + decoder.decode();
}

/** Lets a `SharedBrowser`'s awaits run until it has started its `count`th MCP. */
export async function served(
	ps: FakePs,
	count = 1,
): Promise<FakeChild | undefined> {
	while (ps.getChildren().length < count) {
		await Bun.sleep(1);
	}
	return ps.getChildren()[count - 1];
}

export { FakeAgentPs } from "./fake-agent-ps";
export { HandFedProcess } from "./hand-fed-process";
