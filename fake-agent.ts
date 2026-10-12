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
	/** Whether it says it takes images in a prompt. */
	sees = false;
	/** Every prompt it was sent, block by block, in order. */
	prompts: acp.ContentBlock[][] = [];
	/** The settings set, in order. */
	chosen: { configId: string; value: unknown }[] = [];
	private options = structuredClone(OPTIONS);
	launched: { argv: string[]; cwd: string; env: Record<string, string> }[] = [];
	killed = 0;
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

	private agent(client: acp.AgentSideConnection): acp.Agent {
		return {
			initialize: async () => ({
				protocolVersion: acp.PROTOCOL_VERSION,
				agentCapabilities: this.sees
					? { promptCapabilities: { image: true } }
					: {},
				...(this.steering === null
					? {}
					: { _meta: { steering: { supported: true } } }),
			}),
			extMethod: async (method, params) => {
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
				};
			},
			cancel: async () => {
				this.cancelled++;
			},
		};
	}
}

export function say(text: string): acp.SessionUpdate {
	return {
		sessionUpdate: "agent_message_chunk",
		content: { type: "text", text },
	};
}
