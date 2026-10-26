import { expect, it } from "bun:test";
import { pickOf, runPath, shown, summary } from "./index";
import type { Result } from "./run";

it("reads agent, model and thinking level", () => {
	expect(pickOf("claude:sonnet@high")).toEqual({
		agent: "claude",
		model: "sonnet",
		effort: "high",
	});
	expect(pickOf("codex")).toEqual({ agent: "codex" });
	expect(() => pickOf("cursor:x")).toThrow("no eval runner");
});

function result(status: Result["status"], extra: Partial<Result> = {}): Result {
	return {
		schema: 2,
		scenario: {
			id: "lifecycle/claim",
			aspect: "lifecycle",
			requirement: "Claim it.",
			message: "[SPLATES TASK sample]",
			rubric: null,
		},
		agent: { agent: "claude", model: "sonnet" },
		skill: { label: "current", revision: null },
		repetition: 0,
		startedAt: "2026-10-26T00:00:00.000Z",
		status,
		error: null,
		checks: [
			{
				id: "claimed",
				about: "ran `splates claim sample`",
				pass: status === "pass",
			},
		],
		judge: null,
		reply: "Done.",
		transcript: [],
		usage: { usd: null, tokens: null, turns: null, milliseconds: 0 },
		...extra,
	};
}

it("gives each scenario's pass rate, why a run failed, and errors apart", () => {
	expect(
		summary([
			{ run: "run-000", result: result("pass") },
			{ run: "run-001", result: result("fail") },
			{ run: "run-002", result: result("error", { error: "model not found" }) },
		]),
	).toBe(
		[
			"lifecycle/claim",
			"  claude sonnet\t1/2 pass",
			"    run-001 fail",
			"      claimed: ran `splates claim sample`",
			"",
			"Errors, the harness's or the setup's, not the skill's:",
			"  run-002 lifecycle/claim claude sonnet: model not found",
		].join("\n"),
	);
});

it("finds a run by batch and number or directory, or by its id", () => {
	expect([
		runPath(["batch-a", "3"]),
		runPath(["batch-a", "run-012"]),
		runPath(["batch-a/run-012/result.json"]),
		runPath(["batch-a"]),
	]).toEqual([
		"batch-a/run-003/result.json",
		"batch-a/run-012/result.json",
		"batch-a/run-012/result.json",
		null,
	]);
});

it("shows each step of a run", () => {
	const text = shown(
		result("fail", {
			transcript: [
				{
					kind: "tool",
					name: "Read",
					input: '{"file_path":"value.txt"}',
					output: "one",
				},
			],
		}),
	);
	expect(text).toContain("Held back: claimed: ran `splates claim sample`");
	expect(text).toContain('  > Read {"file_path":"value.txt"}\n    < one');
});
