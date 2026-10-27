import { expect, it } from "bun:test";
import type { EvalDetail } from "@stringsync/splates-server/evals";
import { pickOf, runId, shown, summary, toldBy } from "./index";

it("reads agent, model and thinking level", () => {
	expect(pickOf("claude:sonnet@high")).toEqual({
		agent: "claude",
		model: "sonnet",
		effort: "high",
	});
	expect(pickOf("codex")).toEqual({ agent: "codex" });
	expect(() => pickOf("cursor:x")).toThrow("no eval runner");
});

function result(
	status: EvalDetail["status"],
	extra: Partial<EvalDetail> = {},
): EvalDetail {
	return {
		id: "batch-a#run-000",
		producer: "splates",
		status,
		tokens: null,
		costUsd: null,
		milliseconds: 0,
		scenario: "lifecycle/claim",
		aspect: "lifecycle",
		requirement: "Claim it.",
		target: {
			key: "claude/sonnet",
			agent: "claude",
			model: "sonnet",
			effort: null,
			skill: null,
		},
		repetition: 0,
		input: "[SPLATES TASK sample]",
		rubric: null,
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
		...extra,
	};
}

it("gives each scenario's pass rate, why a run failed, and errors apart", () => {
	expect(
		summary([
			result("pass"),
			result("fail", { id: "batch-a#run-001" }),
			result("error", { id: "batch-a#run-002", error: "model not found" }),
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

it("finds a run by batch and number or name, or by its id", () => {
	expect([
		runId(["batch-a", "3"]),
		runId(["batch-a", "run-012"]),
		runId(["batch-a#run-012"]),
		runId(["batch-a"]),
	]).toEqual(["batch-a#run-003", "batch-a#run-012", "batch-a#run-012", null]);
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

it("reads the selection the Evals card tells evals.run, a line each", () => {
	expect(
		toldBy({
			SPLATES_EVALS_CASES: "resources/install\nresources/whole-suite\n",
			SPLATES_EVALS_TARGETS: "claude:opus@high\ncodex",
			SPLATES_EVALS_REPS: "3",
			SPLATES_EVALS_RESULTS: "/tmp/evals",
		}),
	).toEqual({
		scenario: ["resources/install", "resources/whole-suite"],
		agent: ["claude:opus@high", "codex"],
		reps: "3",
		directory: "/tmp/evals",
	});
	expect(toldBy({})).toEqual({ scenario: [], agent: [] });
});
