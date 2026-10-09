import * as acp from "@agentclientprotocol/sdk";
import type { Agent, AgentProcess } from "./conversations";

/** What the agent does with each prompt, given the connection back to arbor. */
export type Turn = (
	client: acp.AgentSideConnection,
	session: string,
	text: string,
) => Promise<acp.StopReason>;

export const AGENT: Agent = { id: "fake", name: "Fake", argv: ["fake-acp"] };

const MODELS: acp.SessionConfigOption[] = [
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
	launched: { argv: string[]; cwd: string }[] = [];
	killed = 0;
	private exit: (code: number) => void = () => {};

	launch = (argv: string[], cwd: string): AgentProcess => {
		this.launched.push({ argv, cwd });
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
				agentCapabilities: {},
			}),
			newSession: async () => ({ sessionId: "s1", configOptions: MODELS }),
			resumeSession: async ({ sessionId }) => {
				this.resumed.push(sessionId);
				return { configOptions: MODELS };
			},
			authenticate: async () => ({}),
			setSessionConfigOption: async ({ value }) => ({
				configOptions: MODELS.map((option) => ({
					...option,
					currentValue: String(value),
				})) as acp.SessionConfigOption[],
			}),
			prompt: async ({ sessionId, prompt }) => ({
				stopReason: await this.turn(
					client,
					sessionId,
					prompt
						.map((block) => (block.type === "text" ? block.text : ""))
						.join(""),
				),
			}),
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
