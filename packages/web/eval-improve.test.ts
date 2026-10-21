import { describe, expect, test } from "bun:test";
import type { EvalDetail } from "@stringsync/splates-server/evals/browser";
import { improvable, improvePrompt } from "./eval-improve";

describe("improvePrompt", () => {
	const run = {
		id: "b/r/result.json",
		status: "fail",
		probe: "decisions/ask-first",
		aspect: "decisions",
		requirement: "ask-first",
		requirementText: "Asks before removing.",
		target: { key: "k", agent: "claude@1", model: "opus", effort: null },
		repetition: 0,
		input: "Remove the endpoint.",
		termination: "stop",
		detail: null,
		checks: [
			{
				id: "asked",
				status: "fail",
				assertion: { kind: "count" },
				expected: [1, 1],
				actual: 0,
				evidence: [],
			},
			{
				id: "ok",
				status: "pass",
				assertion: { kind: "state" },
				expected: 1,
				actual: 1,
				evidence: [],
			},
		],
		reply: "Removed it.",
		logs: "/tmp/logs",
	} as unknown as EvalDetail;

	test("names the probe, the failing checks, the reply and the trace", () => {
		const text = improvePrompt(run);
		expect(text).toContain("decisions/ask-first");
		expect(text).toContain("`asked` (count, fail)");
		expect(text).not.toContain("`ok`");
		expect(text).toContain("Removed it.");
		expect(text).toContain("/tmp/logs");
	});
});

test("only a failing or uncovered run is improvable", () => {
	expect(improvable("fail")).toBe(true);
	expect(improvable("uncovered")).toBe(true);
	expect(improvable("pass")).toBe(false);
});
