// An ACP agent that runs a shell script for each prompt, for proving a
// worker without an agent CLI or its credentials:
// `bun scripted-agent.ts <turn.sh>`. The script runs in the session's
// directory with the prompt as $1 and the URL of the first HTTP MCP server
// it was offered, such as the shared browser, as $MCP_URL; what it prints
// is the agent's answer.
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";

const script = process.argv[2];
if (script === undefined) {
	throw new Error("usage: bun scripted-agent.ts <turn.sh>");
}
const sessions = new Map<string, { cwd: string; mcp: string }>();
/** Its one model, which a roster entry names to hand it a task. */
const configOptions: acp.SessionConfigOption[] = [
	{
		id: "model",
		name: "Model",
		category: "model",
		type: "select",
		currentValue: "script",
		options: [{ value: "script", name: "Script" }],
	},
];

new acp.AgentSideConnection(
	(client): acp.Agent => ({
		initialize: async () => ({
			protocolVersion: acp.PROTOCOL_VERSION,
			agentCapabilities: { mcpCapabilities: { http: true } },
		}),
		authenticate: async () => ({}),
		newSession: async ({ cwd, mcpServers }) => {
			const sessionId = crypto.randomUUID();
			const http = mcpServers.find((each) => "url" in each);
			sessions.set(sessionId, {
				cwd,
				mcp: http !== undefined && "url" in http ? http.url : "",
			});
			return { sessionId, configOptions };
		},
		setSessionConfigOption: async () => ({ configOptions }),
		prompt: async ({ sessionId, prompt }) => {
			const session = sessions.get(sessionId);
			if (session === undefined) {
				throw acp.RequestError.invalidParams({ sessionId });
			}
			const text = prompt
				.map((block) => (block.type === "text" ? block.text : ""))
				.join("");
			const turn = Bun.spawn(["sh", script, text], {
				cwd: session.cwd,
				env: { ...process.env, MCP_URL: session.mcp },
				stdout: "pipe",
				stderr: "pipe",
			});
			const [out, err, code] = await Promise.all([
				new Response(turn.stdout).text(),
				new Response(turn.stderr).text(),
				turn.exited,
			]);
			await client.sessionUpdate({
				sessionId,
				update: {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: `${out}${err}exit ${code}\n` },
				},
			});
			return { stopReason: "end_turn" };
		},
		cancel: async () => {},
	}),
	acp.ndJsonStream(
		Writable.toWeb(process.stdout) as WritableStream<Uint8Array>,
		Readable.toWeb(process.stdin) as unknown as ReadableStream<Uint8Array>,
	),
);
