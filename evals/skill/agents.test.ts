import { describe, expect, it } from "bun:test";
import {
	commandFor,
	commandsOf,
	readClaude,
	readCodex,
	readKimi,
	readOpenCode,
} from "./agents";

describe("agents", () => {
	it("reads text, tool calls with their results, the reply and usage", () => {
		const run = readClaude([
			{
				type: "assistant",
				message: {
					content: [
						{ type: "text", text: "Looking." },
						{
							type: "tool_use",
							id: "a",
							name: "Bash",
							input: { command: "bun test --changed 2>&1 | tail -40" },
						},
					],
				},
			},
			{
				type: "user",
				message: {
					content: [
						{
							type: "tool_result",
							tool_use_id: "a",
							content: [{ type: "text", text: "1 pass" }],
						},
					],
				},
			},
			{
				type: "result",
				subtype: "success",
				result: "All green.",
				total_cost_usd: 0.1,
				num_turns: 3,
				usage: {
					input_tokens: 10,
					output_tokens: 5,
					cache_read_input_tokens: 85,
				},
			},
		]);

		expect(run.reply).toBe("All green.");
		expect(run.transcript[1]).toEqual({
			kind: "tool",
			name: "Bash",
			input: '{"command":"bun test --changed 2>&1 | tail -40"}',
			output: "1 pass",
		});
		expect(commandsOf(run.transcript)).toEqual([
			"bun test --changed 2>&1 | tail -40",
		]);
		expect(run).toMatchObject({ usd: 0.1, turns: 3, tokens: 100, error: null });
	});

	it("says why a run ended badly", () => {
		expect(
			readClaude([
				{ type: "result", subtype: "error_max_turns", is_error: true },
			]).error,
		).toBe("claude ended: error_max_turns");
	});

	it("reads messages, shell commands and each turn's tokens", () => {
		const run = readCodex([
			{ type: "item.completed", item: { type: "reasoning", text: "hm" } },
			{
				type: "item.completed",
				item: {
					type: "command_execution",
					command: "bun test src/math.test.ts",
					aggregated_output: "2 pass",
					exit_code: 0,
				},
			},
			{
				type: "item.completed",
				item: { type: "agent_message", text: "Fixed." },
			},
			{ type: "turn.completed", usage: { input_tokens: 40, output_tokens: 2 } },
		]);

		expect(run.reply).toBe("Fixed.");
		expect(commandsOf(run.transcript)).toEqual(["bun test src/math.test.ts"]);
		expect(run).toMatchObject({ tokens: 42, turns: 1, usd: null, error: null });
	});

	it("reads OpenCode's text, bash calls, cost, tokens and errors", () => {
		const run = readOpenCode([
			{ type: "step_start", part: { type: "step-start" } },
			{
				type: "tool_use",
				part: {
					tool: "bash",
					state: {
						status: "completed",
						input: { command: "echo hi" },
						output: "hi\n",
					},
				},
			},
			{
				type: "step_finish",
				part: {
					cost: 0.01,
					tokens: { input: 10, output: 5, cache: { read: 20, write: 0 } },
				},
			},
			{ type: "text", part: { text: "done" } },
			{
				type: "step_finish",
				part: { cost: 0.02, tokens: { input: 1, output: 1 } },
			},
		]);

		expect(run.reply).toBe("done");
		expect(commandsOf(run.transcript)).toEqual(["echo hi"]);
		expect(run).toMatchObject({ turns: 2, tokens: 37, error: null });
		expect(run.usd).toBeCloseTo(0.03);
		expect(
			readOpenCode([
				{ type: "error", error: { name: "X", data: { message: "bad key" } } },
			]).error,
		).toBe("opencode: bad key");
		expect(
			commandFor({ agent: "opencode", model: "a/b", effort: "high" }, "Hi.")
				.argv,
		).toContain("a/b#high");
	});

	it("reads Kimi's steps, Bash calls with their results and errors, and runs it headless at a thinking level", () => {
		const run = readKimi([
			{ role: "meta", type: "system.version", version: "2.3.3" },
			{
				role: "assistant",
				content: "Looking.",
				tool_calls: [
					{
						type: "function",
						id: "a",
						function: { name: "Bash", arguments: '{"command":"echo hi"}' },
					},
				],
			},
			{ role: "tool", tool_call_id: "a", content: "hi\n" },
			{ role: "assistant", content: "done" },
		]);

		expect(run.reply).toBe("done");
		expect(commandsOf(run.transcript)).toEqual(["echo hi"]);
		expect(run.transcript[1]).toMatchObject({ output: "hi\n" });
		expect(run).toMatchObject({
			turns: 2,
			tokens: null,
			usd: null,
			error: null,
		});
		expect(
			readKimi([{ type: "error", code: "x", message: "session busy" }]).error,
		).toBe("kimi: session busy");

		const { argv, format } = commandFor(
			{ agent: "kimi", model: "kimi-code/k3.1-pro", effort: "high" },
			"Hi.",
			{ turns: 5 },
		);
		expect(format).toBe("kimi");
		expect(argv).toContain("KIMI_MODEL_THINKING_EFFORT=high");
		expect(argv).toContain("KIMI_LOOP_MAX_STEPS_PER_TURN=5");
		expect(argv).toContain("--auto");
		expect(argv.slice(-4)).toEqual([
			"--model",
			"kimi-code/k3.1-pro",
			"--prompt",
			"Hi.",
		]);
	});

	it("runs Claude headless on the person's login without their settings, and refuses an agent it has no runner for", () => {
		const { argv, format } = commandFor(
			{ agent: "claude", model: "sonnet" },
			"Hi.",
			{ usd: 0.5 },
		);

		expect(format).toBe("claude");
		expect(argv).toContain("bypassPermissions");
		expect(
			argv.slice(
				argv.indexOf("--setting-sources"),
				argv.indexOf("--setting-sources") + 2,
			),
		).toEqual(["--setting-sources", "project,local"]);
		expect(
			argv.slice(
				argv.indexOf("--max-budget-usd"),
				argv.indexOf("--max-budget-usd") + 2,
			),
		).toEqual(["--max-budget-usd", "0.5"]);
		expect(argv.at(-1)).toBe("Hi.");
		expect(() => commandFor({ agent: "aider" }, "Hi.")).toThrow(
			"no eval runner",
		);
	});
});
