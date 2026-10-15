import { describe, expect, it } from "bun:test";
import { readRun } from "./transcript";

describe("readRun", () => {
	it("reads the agent's own words, commands and edits as beats, each turn led by its prompt", () => {
		const log = readRun([TURN], ["[ARBOR TODO #1]"]);
		expect(log.transcript.beats).toEqual([
			{ kind: "user", text: "[ARBOR TODO #1]" },
			{ kind: "say", text: "## 🌱 Added retry-413" },
			{
				kind: "run",
				command: "arbor add retry-413 --todo 1",
				output: "added retry-413",
				ok: true,
			},
			{ kind: "edit", paths: ["/repo/src/upload.ts"] },
		]);
	});

	it("leaves a subagent's calls out of the beats and tools, but in the text a model grades", () => {
		const log = readRun([TURN], ["go"]);
		expect(log.tools.map((tool) => tool.name)).toEqual(["Bash", "Edit"]);
		expect(log.text).toContain("TOOL [subagent] Bash: bun test");
	});

	it("keeps what each turn cost from its result line", () => {
		expect(readRun([TURN], ["go"]).usage).toEqual([
			{
				costUsd: 0.3,
				inputTokens: 10,
				outputTokens: 200,
				cacheReadTokens: 1000,
				cacheWriteTokens: 50,
			},
		]);
	});
});

const TURN = [
	{ type: "system", subtype: "init", session_id: "s1" },
	{
		type: "assistant",
		parent_tool_use_id: null,
		message: { content: [{ type: "text", text: "## 🌱 Added retry-413" }] },
	},
	{
		type: "assistant",
		parent_tool_use_id: null,
		message: {
			content: [
				{
					type: "tool_use",
					id: "t1",
					name: "Bash",
					input: { command: "arbor add retry-413 --todo 1" },
				},
			],
		},
	},
	{
		type: "user",
		parent_tool_use_id: null,
		message: {
			content: [
				{
					type: "tool_result",
					tool_use_id: "t1",
					content: "added retry-413",
					is_error: false,
				},
			],
		},
	},
	{
		type: "assistant",
		parent_tool_use_id: null,
		message: {
			content: [
				{
					type: "tool_use",
					id: "t2",
					name: "Edit",
					input: { file_path: "/repo/src/upload.ts", new_string: "x" },
				},
			],
		},
	},
	{
		type: "assistant",
		parent_tool_use_id: "agent1",
		message: {
			content: [
				{
					type: "tool_use",
					id: "t3",
					name: "Bash",
					input: { command: "bun test" },
				},
			],
		},
	},
	{
		type: "result",
		result: "done",
		total_cost_usd: 0.3,
		usage: {
			input_tokens: 10,
			output_tokens: 200,
			cache_read_input_tokens: 1000,
			cache_creation_input_tokens: 50,
		},
	},
].map((event) => JSON.stringify(event));
