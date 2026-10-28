import { expect, test } from "bun:test";
import { evalsDonePrompt } from "@stringsync/splates-server/evals";
import type { EvalGrid } from "@stringsync/splates-server/evals/browser";
import { evalsDoneLine, evalsDoneOf } from "./evals-done";

const grid: EvalGrid = {
	id: "batch-abc",
	skill: "splates",
	producer: "splates",
	startedAt: "2026-10-25T00:00:00.000Z",
	targets: [],
	tally: { pass: 2 },
	cells: 2,
	tokens: null,
	costUsd: null,
	grid: [],
};

test("reads the batch and its tally back from what the server tells the agent", () => {
	const text = evalsDonePrompt(grid, []);
	const done = evalsDoneOf(text);

	expect(done).toEqual({ batch: "batch-abc", summary: "2 cells · 2 pass" });
	expect(
		evalsDoneLine(done ?? { batch: "", summary: "" }, null, text).words,
	).toEqual(["Finished"]);
});

test("reads nothing from another message", () => {
	expect(evalsDoneOf("[SPLATES EVALS DONE batch-abc]")).toBeNull();
});
