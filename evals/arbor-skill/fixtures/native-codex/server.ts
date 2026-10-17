// Free App Server wire stand-in. Never imports a model client or accesses credentials.
import { type ChildProcess, spawn } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

const scenario = process.argv[2];
const log = process.argv[3] as string;
let root = "";
let cwd = "";
const send = (value: unknown) =>
	process.stdout.write(`${JSON.stringify(value)}\n`);
const notice = (method: string, params: object) =>
	send({
		method,
		params: { threadId: "thread-1", turnId: "turn-1", ...params },
	});
const usage = (total: number) =>
	notice("thread/tokenUsage/updated", {
		tokenUsage: {
			total: {
				inputTokens: total - 2,
				cachedInputTokens: 1,
				outputTokens: 2,
				reasoningOutputTokens: 1,
				totalTokens: total,
			},
			last: { totalTokens: 3 },
			modelContextWindow: 100000,
		},
	});
const end = (status = "completed") =>
	notice("turn/completed", {
		turn: {
			id: "turn-1",
			status,
			items: [],
			error: status === "failed" ? { message: "fixture error" } : null,
		},
	});
writeFileSync(`${log}.pid`, String(process.pid));
let child: ChildProcess | undefined;
if (scenario === "child") {
	child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
		stdio: "ignore",
	});
	writeFileSync(`${log}.child`, String(child.pid));
}
for await (const line of createInterface({ input: process.stdin })) {
	const message = JSON.parse(line);
	appendFileSync(log, `${line}\n`);
	const { id, method, params } = message;
	if (id === "approval") {
		usage(12);
		notice("item/completed", {
			item: {
				type: "agentMessage",
				id: "reply",
				phase: "final_answer",
				text: "done",
			},
		});
		end();
	}
	if (method === undefined || method === "initialized") {
		continue;
	}
	if (scenario === "startup-hang") {
		continue;
	}
	if (scenario === "malformed") {
		process.stdout.write("{bad json\n");
		continue;
	}
	if (scenario === "exit") {
		process.exit(7);
	}
	if (method === "thread/backgroundTerminals/clean") {
		if (child) {
			const exited = new Promise<void>((done) =>
				child?.once("exit", () => done()),
			);
			child.kill("SIGKILL");
			await exited;
		}
		send({ id, result: {} });
	}
	if (method === "initialize") {
		send({
			id,
			result: {
				userAgent: `fixture/${scenario === "version" ? "0.1.0" : "0.156.0"} (fixture)`,
			},
		});
	}
	if (method === "account/read") {
		send({
			id,
			result: {
				account: scenario === "auth" ? null : { type: "apiKey" },
				requiresOpenaiAuth: true,
			},
		});
	}
	if (method === "config/read") {
		send({
			id,
			result: {
				config: { mcp_servers: { fixture: {} }, plugins: { fixture: {} } },
			},
		});
	}
	if (method === "skills/extraRoots/set") {
		root = params.extraRoots[0];
		if (scenario === "capability") {
			send({ id, error: { code: -32601, message: "not supported" } });
		} else {
			send({ id, result: {} });
		}
	}
	if (method === "skills/list") {
		send({
			id,
			result: {
				data: [
					{
						cwd: params.cwds[0],
						skills:
							scenario === "skill"
								? []
								: [
										{
											name: "arbor",
											path: join(root, "SKILL.md"),
											enabled: true,
											scope: "user",
											description: "fixture",
										},
									],
						errors: [],
					},
				],
			},
		});
	}
	if (method === "thread/start") {
		cwd = params.cwd;
		send({
			id,
			result: {
				thread: { id: "thread-1" },
				model: scenario === "model" ? "other" : params.model,
				cwd,
				approvalPolicy: "never",
				approvalsReviewer: "user",
				instructionSources: [],
				sandbox: {
					type: "workspaceWrite",
					writableRoots: [],
					networkAccess: scenario === "permission",
					excludeTmpdirEnvVar: true,
					excludeSlashTmp: true,
				},
			},
		});
	}
	if (method === "turn/start") {
		notice("turn/started", {
			turn: { id: "turn-1", status: "inProgress", items: [] },
		});
		send({
			id,
			result: { turn: { id: "turn-1", status: "inProgress", items: [] } },
		});
		if (scenario === "hang" || scenario === "child") {
			continue;
		}
		if (scenario === "broken-stream") {
			usage(12);
			process.exit(9);
		}
		if (scenario === "cancel") {
			usage(110);
			continue;
		}
		if (scenario === "failed") {
			usage(12);
			end("failed");
			continue;
		}
		if (scenario === "approval") {
			send({
				id: "approval",
				method: "item/commandExecution/requestApproval",
				params: {
					threadId: "thread-1",
					turnId: "turn-1",
					itemId: "cmd",
					command: "arbor merge",
				},
			});
		}
		if (scenario === "approval") {
			continue;
		}
		if (scenario !== "missing-usage") {
			usage(7);
			usage(12);
			usage(12);
		}
		if (scenario === "regression") {
			usage(3);
			continue;
		}
		notice("item/completed", {
			item: {
				type: "commandExecution",
				id: "cmd",
				command: "arbor merge && cat SKILL.md",
				cwd,
				status: "completed",
				exitCode: 0,
				aggregatedOutput: "done",
			},
		});
		notice("item/completed", {
			item: {
				type: "agentMessage",
				id: "comment",
				phase: "commentary",
				text: "working",
			},
		});
		notice("item/completed", {
			item: {
				type: "agentMessage",
				id: "reply",
				phase: scenario === "missing-phase" ? null : "final_answer",
				text: "## ✅ Merged sample onto main\n\nThe sample now works.",
			},
		});
		end();
	}
	if (method === "turn/interrupt") {
		usage(117);
		send({ id, result: {} });
		end("interrupted");
	}
}
