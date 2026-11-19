import { describe, expect, test } from "bun:test";
import { conversation, message, todo } from "@splates/server/fixtures";
import type { Needing } from "@splates/server/plans/browser";
import type { RunState } from "@splates/server/ship";
import { spawnedWork } from "./ship-spawned-work";

describe("spawnedWork", () => {
	test("a failed step's fix shows how the run recorded it ended", () => {
		const work = spawnedWork({
			run: run([step("test", { task: 7, at: 2_000, ended: "merged" })]),
			todos: [],
			conversations: [],
			needing: [],
		});
		expect(work).toEqual([
			{
				kind: "fix",
				todo: 7,
				subject: "Fix test",
				target: "@stringsync/vexml",
				step: "test",
				status: "merged",
			},
		]);
	});

	test("a fix not yet taken is queued, under its board task's subject", () => {
		const [work] = spawnedWork({
			run: run([step("test", { task: 7, at: 2_000 })]),
			todos: [todo({ id: 7, subject: "The test step passes" })],
			conversations: [],
			needing: [],
		});
		expect(work?.status).toBe("queued");
		expect(work?.subject).toBe("The test step passes");
	});

	test("a ship's own task whose agent asks shows its question and conversation", () => {
		const talk = conversation({
			id: "c9",
			task: "upstream-check",
			ship: "run-1",
		});
		const needing: Needing[] = [
			{
				conversation: talk,
				task: null,
				need: {
					kind: "waiting",
					why: "questions",
					subject: "Keep the old constructor?",
					since: null,
					questions: [],
				},
			},
		];
		const work = spawnedWork({
			run: run([step("test")]),
			todos: [
				todo({
					id: 9,
					subject: "Check the update",
					takenBy: "upstream-check",
					ship: { run: "run-1", step: "test" },
				}),
				todo({ id: 10, ship: { run: "run-2", step: "test" } }),
			],
			conversations: [talk],
			needing,
		});
		expect(work).toEqual([
			{
				kind: "agent",
				todo: 9,
				conversation: "c9",
				subject: "Check the update",
				target: "@stringsync/vexml",
				step: "test",
				status: "asking",
				line: "Keep the old constructor?",
			},
		]);
	});

	test("a ship's conversation whose board task is gone ends as its report says", () => {
		const talk = conversation({
			id: "c3",
			lastTask: "upstream-check",
			ship: "run-1",
			name: "Check the update",
			messages: [
				message("agent", "## ✅ Merged upstream-check onto main\n\nDone."),
			],
		});
		const work = spawnedWork({
			run: run([step("test")]),
			todos: [],
			conversations: [talk],
			needing: [],
		});
		expect(work).toEqual([
			{
				kind: "agent",
				conversation: "c3",
				subject: "Check the update",
				status: "merged",
			},
		]);
	});
});

const step = (
	id: string,
	fix?: NonNullable<RunState["targets"][0]["steps"][0]["fix"]>,
) => ({
	id,
	does: `Do ${id}`,
	dependencies: [],
	status: "failed" as const,
	output: [],
	prompts: [],
	...(fix !== undefined && { fix }),
});

const run = (steps: ReturnType<typeof step>[]): RunState => ({
	id: "run-1",
	started: 1_000,
	status: "failed",
	notes: [],
	targets: [
		{
			name: "@stringsync/vexml",
			command: "bin/vex ship",
			dependencies: [],
			steps,
		},
	],
});
