import { expect, it } from "bun:test";
import { FakeFs } from "core/system/testing";
import { codexEvidence, nativeCalls } from "./codex-evidence";

it("recovers native image calls and results in order without copying image bytes or prompts", () => {
	expect(nativeCalls(records)).toEqual([
		{
			kind: "tool",
			name: "exec",
			input:
				'for (const path of ["slices/12/shot-at.png", "slices/12/shot-before.png"]) { image((await tools.view_image({path})).image_url); }',
			output:
				'[{"type":"input_image","image_url":"[inline media omitted]"},{"type":"input_text","text":"Completed"}]',
		},
		{
			kind: "tool",
			name: "view_image",
			input: '{"path":"slices/305/shot-at.png"}',
			output: "image loaded",
		},
	]);
});

it("selects only a rollout whose filename, thread ID and cwd match the run", async () => {
	const fs = new FakeFs();
	await fs.mkdir("/codex/sessions/2026/11/13");
	await fs.write(
		"/codex/sessions/2026/11/13/rollout-thread-123.jsonl",
		records.map((line) => JSON.stringify(line)).join("\n"),
	);
	expect(await codexEvidence("thread-123", "/repo", "/codex", fs)).toEqual(
		nativeCalls(records),
	);
	const refused = await Promise.allSettled([
		codexEvidence("thread-123", "/another-repo", "/codex", fs),
		codexEvidence("thread-other", "/repo", "/codex", fs),
		codexEvidence("../thread-123", "/repo", "/codex", fs),
	]);
	expect(refused.map((result) => result.status)).toEqual([
		"rejected",
		"rejected",
		"rejected",
	]);
});

// Minimal response-item shapes from batch-vtt4CB run-003's original rollout.
const records = [
	{ type: "session_meta", payload: { id: "thread-123", cwd: "/repo" } },
	{
		type: "response_item",
		payload: { type: "message", role: "user", content: "Do not copy prompts" },
	},
	{
		type: "response_item",
		payload: {
			type: "custom_tool_call",
			call_id: "a",
			name: "exec",
			input:
				'for (const path of ["slices/12/shot-at.png", "slices/12/shot-before.png"]) { image((await tools.view_image({path})).image_url); }',
		},
	},
	{
		type: "response_item",
		payload: {
			type: "custom_tool_call_output",
			call_id: "a",
			output: [
				{
					type: "input_image",
					image_url: `data:image/png;base64,${"a".repeat(80000)}`,
				},
				{ type: "input_text", text: "Completed" },
			],
		},
	},
	{
		type: "response_item",
		payload: {
			type: "function_call",
			call_id: "b",
			name: "view_image",
			arguments: '{"path":"slices/305/shot-at.png"}',
		},
	},
	{
		type: "response_item",
		payload: {
			type: "function_call_output",
			call_id: "b",
			output: "image loaded",
		},
	},
];
