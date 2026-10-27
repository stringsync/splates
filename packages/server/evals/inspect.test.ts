import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type InspectLog, inspectBatch, writeImported } from "./index";
import { EvalStore } from "./store";

describe("an Inspect log imported", () => {
	let directory: string;
	let store: EvalStore;

	beforeEach(async () => {
		directory = await mkdtemp(join(tmpdir(), "eval-inspect-test-"));
		store = new EvalStore(directory);
	});

	afterEach(() => rm(directory, { recursive: true, force: true }));

	it("shows a cell per sample and epoch, passing on a C", async () => {
		await writeImported(join(directory, "nightly"), inspectBatch(LOG, 1));

		const grid = await store.grid("nightly");
		expect(grid?.targets.map((target) => target.model)).toEqual([
			"anthropic/claude-opus-5-5",
		]);
		expect(
			grid?.grid.map((cell) => [
				cell.scenario,
				cell.aspect,
				cell.repetition,
				cell.run?.status,
			]),
		).toEqual([
			["add", "arithmetic", 0, "pass"],
			["7", "arithmetic", 1, "fail"],
			["broken", "arithmetic", 0, "error"],
		]);
		expect(grid?.grid[0]?.run).toMatchObject({
			score: 1,
			reason: "matches 4",
			tokens: 120,
			costUsd: 0.01,
			milliseconds: 1500,
		});
		expect(grid?.grid[1]?.run).toMatchObject({
			score: 0.375,
			reason: "wanted 9",
		});
		expect(grid?.grid[2]?.run?.error).toBe("rate limited");
	});

	it("opens a cell with its input, target, scorers and conversation", async () => {
		await writeImported(join(directory, "nightly"), inspectBatch(LOG, 1));

		expect(await store.run("nightly#c0")).toMatchObject({
			input: "What is 2 + 2?",
			rubric: "4",
			reply: "4",
			checks: [{ id: "match", about: "matches 4", pass: true }],
			transcript: [
				{ kind: "text", text: "user: What is 2 + 2?" },
				{ kind: "text", text: "assistant: Let me check." },
				{ kind: "tool", name: "calc", input: '{"expr":"2+2"}', output: "4" },
				{ kind: "text", text: "assistant: 4" },
			],
		});
		expect((await store.run("nightly#c1")).input).toBe("What is 3 * 3?");
	});

	it("passes a scaled score at --pass-at", () => {
		const graded = inspectBatch(
			{
				...LOG,
				samples: [{ id: "x", input: "?", scores: { g: { value: 0.75 } } }],
			},
			0.7,
		);

		expect(graded.results[0]).toMatchObject({ status: "pass", score: 0.75 });
	});
});

const LOG: InspectLog = {
	status: "success",
	eval: {
		task: "arithmetic",
		model: "anthropic/claude-opus-5-5",
		created: "2026-10-26T12:00:00+00:00",
	},
	stats: { started_at: "2026-10-26T12:00:01+00:00" },
	samples: [
		{
			id: "add",
			epoch: 1,
			input: "What is 2 + 2?",
			target: "4",
			messages: [
				{ role: "user", content: "What is 2 + 2?" },
				{
					role: "assistant",
					content: [{ type: "text", text: "Let me check." }],
					tool_calls: [
						{ id: "t1", function: "calc", arguments: { expr: "2+2" } },
					],
				},
				{ role: "tool", content: "4", tool_call_id: "t1" },
				{ role: "assistant", content: "4" },
			],
			output: { completion: "4" },
			scores: { match: { value: "C", answer: "4", explanation: "matches 4" } },
			model_usage: {
				"anthropic/claude-opus-5-5": { total_tokens: 120, total_cost: 0.01 },
			},
			total_time: 1.5,
		},
		{
			id: 7,
			epoch: 2,
			input: [{ role: "user", content: "What is 3 * 3?" }],
			output: { completion: "6" },
			scores: {
				match: { value: "I", explanation: "wanted 9" },
				graded: { value: 0.75 },
			},
		},
		{
			id: "broken",
			input: "?",
			error: { message: "rate limited" },
		},
	],
};
