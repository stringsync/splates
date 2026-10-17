import { spawn } from "node:child_process";
import { cp, readFile } from "node:fs/promises";
import { join } from "node:path";
import * as acp from "@agentclientprotocol/sdk";
import type {
	Agent,
	AgentProcess,
	Launch,
} from "@webappwiz/arbor/probe-runtime";
import { AgentStream, framed } from "@webappwiz/arbor/probe-runtime";
import { command } from "./probe-sandbox";
import { awaitProcessGroupExit } from "./process-group";
import type { Adapter, RunContext } from "./runner";

/** Launch commands inside this probe and stop their descendants when its scope ends. */
export function launchIsolated(context: RunContext): Launch {
	return (argv, cwd, env): AgentProcess => {
		context.signal.throwIfAborted();
		const child = spawn(argv[0] as string, argv.slice(1), {
			cwd,
			env,
			detached: true,
			stdio: "pipe",
		});
		let stderr = "";
		child.stderr.on("data", (bytes: Buffer) => {
			stderr += bytes.toString();
			context.trace({ stderr: bytes.toString() });
		});
		let failed = false;
		child.stdin.on("error", () => {});
		const exited = new Promise<number>((resolve) => {
			child.once("error", (error) => {
				stderr += String(error);
				failed = true;
			});
			child.once("close", (code) => resolve(failed ? 127 : (code ?? 1)));
		}).then(async (code) => {
			await awaitProcessGroupExit(child.pid);
			return code;
		});
		// Cleanup owns failures even when cancellation wins the adapter race.
		void exited.catch(() => {});
		let killed = false;
		const kill = () => {
			if (killed) {
				return;
			}
			killed = true;
			if (child.pid !== undefined) {
				try {
					process.kill(-child.pid, "SIGKILL");
				} catch {
					// The process may exit between cancellation and the signal.
				}
			}
		};
		child.once("exit", kill);
		context.cleanup(async () => {
			kill();
			await exited;
		});
		return {
			pid: child.pid ?? null,
			handle: null,
			ack: () => {},
			stderr: () => stderr,
			exited,
			kill,
			input: new WritableStream({
				write(bytes) {
					child.stdin.write(bytes);
				},
				close() {
					child.stdin.end();
				},
			}),
			output: framed(
				new ReadableStream({
					start(controller) {
						child.stdout.on("data", (bytes: Buffer) => {
							context.trace({ stdout: bytes.toString() });
							controller.enqueue(new Uint8Array(bytes));
						});
						// Failed spawns close stdout without emitting end.
						child.stdout.once("close", () => controller.close());
					},
				}),
			),
		};
	};
}

/** Only the direct invocation is instrumented; nested shell/process activity is not certified. */
export const cliAdapter: Adapter = {
	id: "cli",
	version: "1",
	config: {},
	tokenBound: true,
	async run(context) {
		const { probe } = context;
		if (probe.execution.kind !== "cli") {
			throw new Error("CLI adapter requires a CLI probe");
		}
		await command(context, probe.execution.command, "cli");
		// stdout is tool output, never an assistant reply. A CLI probe must use an event boundary.
	},
};

/** ACP reuses the configured roster argv, but never promotes tool-call claims to execution events. */
export function acpAdapter(
	agent: Agent,
	skill: string,
	launch?: Launch,
): Adapter {
	return {
		id: agent.id,
		version: "acp-1",
		config: { argv: agent.argv, skill },
		tokenBound: false,
		async run(context, model) {
			if (context.probe.execution.kind === "cli") {
				return cliAdapter.run(context, null);
			}
			if (context.probe.stop.kind === "event") {
				context.evidence.termination = "unsupported";
				context.evidence.detail =
					"ACP does not certify native command/read/write execution; event stops require an instrumented adapter";
				return;
			}
			if (context.probe.tools.length) {
				context.evidence.termination = "unsupported";
				context.evidence.detail =
					"Generic ACP cannot enforce a native tool allowlist; this adapter supports tool-free reply probes only";
				return;
			}
			const snapshot = join(context.isolation.outputs, "skill");
			await cp(skill, snapshot, { recursive: true, dereference: true });
			context.signal.throwIfAborted();
			const child = (launch ?? launchIsolated(context))(
				agent.argv,
				context.isolation.repository,
				context.env,
			);
			// Injectable launches (the free fake) own their transport but still get stopped.
			if (launch) {
				context.cleanup(() => child.kill());
			}
			let reply = "";
			let connection: acp.ClientSideConnection;
			connection = new acp.ClientSideConnection(
				() => ({
					sessionUpdate: async ({ update }) => {
						context.trace({ update });
						if (
							update.sessionUpdate === "usage_update" &&
							update.cost?.currency === "USD"
						) {
							context.usage.costUsd = update.cost.amount;
						}
						if (
							update.sessionUpdate === "agent_message_chunk" &&
							update.content.type === "text"
						) {
							reply += update.content.text;
						}
					},
					// Unrestricted native tools cannot be safely allowed by a generic ACP adapter.
					requestPermission: async (request) => {
						context.trace({ permission: request });
						return { outcome: { outcome: "cancelled" } };
					},
				}),
				new AgentStream(child),
			);
			const work = async () => {
				const initialized = await connection.initialize({
					protocolVersion: acp.PROTOCOL_VERSION,
					clientCapabilities: {},
				});
				context.trace({ initialized });
				context.runtime.agentInfo = JSON.parse(
					JSON.stringify(initialized.agentInfo ?? null),
				);
				context.signal.throwIfAborted();
				const session = await connection.newSession({
					cwd: context.isolation.repository,
					mcpServers: [],
				});
				context.trace({ session });
				if (model !== null) {
					const option = session.configOptions?.find(
						(each) => each.category === "model",
					);
					if (option) {
						const selected = await connection.setSessionConfigOption({
							sessionId: session.sessionId,
							configId: option.id,
							value: model,
						});
						context.trace({ selected });
						if (
							selected.configOptions.find((each) => each.id === option.id)
								?.currentValue !== model
						) {
							context.evidence.termination = "unsupported";
							context.evidence.detail = `adapter did not confirm model ${model}`;
							return;
						}
					} else {
						context.evidence.termination = "unsupported";
						context.evidence.detail = `adapter does not expose requested model ${model}`;
						return;
					}
				}
				context.signal.throwIfAborted();
				// One contract input is one turn. Seed handlers never manufacture paid setup turns.
				context.usage.turns = 1;
				const instruction = await readFile(join(snapshot, "SKILL.md"), "utf8");
				const response = await connection.prompt({
					sessionId: session.sessionId,
					prompt: [
						{
							type: "text",
							text: `${instruction}\n\n${context.probe.input.text}`,
						},
					],
				});
				context.trace({ response });
				if (response.usage) {
					context.usage.tokens = response.usage.totalTokens;
				}
				if (response.stopReason === "end_turn") {
					context.reply(reply);
				} else {
					context.evidence.termination = "bound";
					context.evidence.detail = `ACP stop: ${response.stopReason}`;
				}
			};
			try {
				await Promise.race([
					work(),
					child.exited.then((code) => {
						throw new Error(`agent exited ${code}: ${child.stderr()}`);
					}),
				]);
			} catch (error) {
				if (
					error instanceof acp.RequestError &&
					error.code === acp.RequestError.authRequired().code
				) {
					context.evidence.termination = "unsupported";
					context.evidence.detail =
						"Agent requires authentication in its isolated home; credentials are never copied from the user home";
				} else {
					throw error;
				}
			}
			if (!context.evidence.detail) {
				context.evidence.detail =
					"ACP native tool events are incomplete; permissions denied; token/spend limits unavailable";
			}
		},
	};
}
