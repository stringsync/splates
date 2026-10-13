import { describe, expect, it } from "bun:test";
import { FakeTimer } from "webappwiz/time/testing";
import { codexLimits, isCodex } from "./codex-limits";
import type { AgentProcess } from "./conversations";

/** A Codex app server that answers each request with `answers[method]`. */
function appServer(answers: Record<string, unknown>) {
	const asked: unknown[] = [];
	const started: string[][] = [];
	let killed = false;
	const output = new TransformStream<Uint8Array, Uint8Array>();
	const writer = output.writable.getWriter();
	const decoder = new TextDecoder();
	const input = new WritableStream<Uint8Array>({
		async write(chunk) {
			for (const line of decoder.decode(chunk).split("\n").filter(Boolean)) {
				const message = JSON.parse(line) as { id?: number; method: string };
				asked.push(message.method);
				if (message.id !== undefined && message.method in answers) {
					await writer.write(
						new TextEncoder().encode(
							`${JSON.stringify({ id: message.id, result: answers[message.method] })}\n`,
						),
					);
				}
			}
		},
	});
	return {
		asked,
		started,
		killed: () => killed,
		launch: (argv: string[]): AgentProcess => {
			started.push(argv);
			return {
				pid: 1,
				input,
				output: output.readable,
				stderr: () => "",
				exited: new Promise(() => {}),
				kill: () => {
					killed = true;
				},
			};
		},
	};
}

const NOW = Date.parse("2026-10-13T10:00:00Z");

describe("codexLimits", () => {
	it("asks Codex's app server for the plan's windows, naming those Claude has too", async () => {
		const server = appServer({
			initialize: {},
			"account/rateLimits/read": {
				rateLimits: {
					primary: {
						usedPercent: 42,
						windowDurationMins: 300,
						resetsAt: 1_791_738_000,
					},
					secondary: {
						usedPercent: 7,
						windowDurationMins: 43200,
						resetsAt: 1_794_145_661,
					},
				},
			},
		});

		const limits = await codexLimits({
			launch: server.launch,
			timer: new FakeTimer(),
			now: () => NOW,
			cwd: "/repo",
			codex: "/opt/codex",
		});

		expect(server.started).toEqual([["/opt/codex", "app-server"]]);
		expect(server.asked).toEqual([
			"initialize",
			"initialized",
			"account/rateLimits/read",
		]);
		expect(limits).toEqual([
			{
				window: "five_hour",
				used: 0.42,
				resets: "2026-10-11T17:00:00.000Z",
				at: "2026-10-13T10:00:00.000Z",
			},
			{
				window: "43200_minutes",
				used: 0.07,
				resets: "2026-11-08T13:47:41.000Z",
				at: "2026-10-13T10:00:00.000Z",
			},
		]);
		expect(server.killed()).toBe(true);
	});

	it("says none when Codex does not answer in time", async () => {
		const server = appServer({});
		const timer = new FakeTimer();

		const asking = codexLimits({
			launch: server.launch,
			timer,
			now: () => NOW,
			cwd: "/repo",
		});
		await Bun.sleep(0);
		timer.fireTimeouts();

		expect(await asking).toEqual([]);
		expect(server.killed()).toBe(true);
	});

	it("knows Codex by its adapter", () => {
		expect(
			isCodex({
				id: "c",
				name: "C",
				argv: ["bunx", "@agentclientprotocol/codex-acp"],
			}),
		).toBe(true);
		expect(
			isCodex({
				id: "c",
				name: "C",
				argv: ["bunx", "@agentclientprotocol/claude-agent-acp"],
			}),
		).toBe(false);
	});
});
