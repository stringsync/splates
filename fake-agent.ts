import * as acp from "@agentclientprotocol/sdk";
import type { Agent, AgentProcess } from "./conversations";
import type { RosterAgent } from "./roster";

/** What the agent does with each prompt, given the connection back to arbor. */
export type Turn = (
	client: acp.AgentSideConnection,
	session: string,
	text: string,
) => Promise<acp.StopReason>;

export const AGENT: Agent = { id: "fake", name: "Fake", argv: ["fake-acp"] };

/** `AGENT` as the roster lists it, with the models its Model setting offers. */
export const ROSTERED: RosterAgent = {
	...AGENT,
	models: [
		{ id: "big", name: "Big", strengths: "hard problems", cost: "high" },
		{ id: "small", name: "Small", strengths: "quick edits", cost: "low" },
	],
};

const OPTIONS: acp.SessionConfigOption[] = [
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
	 * offer it, the default.
	 */
	steering: "injected" | "promptRequired" | null = null;
	/** What was steered into a turn, in order. */
	steered: string[] = [];
	/** What arbor said it can take, as it started the last process. */
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
	/** Every prompt it was sent, block by block, in order. */
	prompts: acp.ContentBlock[][] = [];
	/** The settings set, in order. */
	chosen: { configId: string; value: unknown }[] = [];
	private options = structuredClone(OPTIONS);
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
		const toClient = new TransformStream<Uint8Array, Uint8Array>();
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
			output: toClient.readable,
			stderr: () => "fake agent fell over",
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

	private client: acp.AgentSideConnection | null = null;

	private agent(client: acp.AgentSideConnection): acp.Agent {
		this.client = client;
		return {
			initialize: async ({ clientCapabilities }) => {
				this.capabilities = clientCapabilities ?? null;
				return {
					protocolVersion: acp.PROTOCOL_VERSION,
					agentCapabilities: {
						...(this.sees ? { promptCapabilities: { image: true } } : {}),
						...(this.held === null
							? {}
							: { loadSession: true, sessionCapabilities: { list: {} } }),
					},
					...(this.steering === null
						? {}
						: { _meta: { steering: { supported: true } } }),
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
				if (method !== "_session/steering" || this.steering === null) {
					throw acp.RequestError.methodNotFound(method);
				}
				const prompt = params.prompt as acp.ContentBlock[];
				if (this.steering === "injected") {
					this.steered.push(
						prompt
							.map((block) => (block.type === "text" ? block.text : ""))
							.join(""),
					);
				}
				return { outcome: this.steering };
			},
			newSession: async () => ({
				sessionId: "s1",
				configOptions: this.options,
			}),
			listSessions: async ({ cwd }) => ({
				sessions: (this.held ?? [])
					.filter((each) => cwd == null || each.cwd === cwd)
					.map(({ replay: _, ...info }) => info),
			}),
			loadSession: async ({ sessionId }) => {
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
			resumeSession: async ({ sessionId }) => {
				this.resumed.push(sessionId);
				return { configOptions: this.options };
			},
			authenticate: async () => ({}),
			setSessionConfigOption: async ({ configId, value }) => {
				this.chosen.push({ configId, value });
				this.options = this.options.map((option) =>
					option.id === configId
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
