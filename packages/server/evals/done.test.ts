import { describe, expect, it } from "bun:test";
import { evalsDonePrompt } from "./done";
import type { EvalDetail, EvalGrid } from "./types";

describe("evalsDonePrompt", () => {
	const claude = {
		key: "native-claude@4/sonnet",
		agent: "native-claude@4",
		model: "sonnet",
		effort: null,
	};
	const codex = {
		key: "native-codex@4/gpt",
		agent: "native-codex@4",
		model: "gpt",
		effort: null,
	};
	const run = (id: string, status: "pass" | "fail") => ({
		id,
		status,
		unjudged: 0,
		tokens: 10,
		costUsd: 0.01,
		milliseconds: 1,
	});
	const grid: EvalGrid = {
		id: "batch-abc",
		kind: "batch",
		skill: "splates",
		startedAt: "2026-10-25T00:00:00.000Z",
		targets: [claude, codex],
		tally: { pass: 1, fail: 1 },
		cells: 2,
		tokens: 1234,
		costUsd: 0.42,
		grid: [
			{
				probe: "resources/install",
				aspect: "resource-control",
				requirement: "host-heavy-work",
				target: claude.key,
				repetition: 0,
				run: run("batch-abc/run-1/result.json", "fail"),
			},
			{
				probe: "resources/install",
				aspect: "resource-control",
				requirement: "host-heavy-work",
				target: codex.key,
				repetition: 0,
				run: run("batch-abc/run-2/result.json", "pass"),
			},
		],
	};
	const failed = {
		...run("batch-abc/run-1/result.json", "fail"),
		probe: "resources/install",
		aspect: "resource-control",
		requirement: "host-heavy-work",
		requirementText: "Ask before installing.",
		target: claude,
		repetition: 0,
		input: "Install.",
		termination: "stop",
		detail: null,
		checks: [
			{
				id: "install-card",
				status: "fail",
				assertion: { kind: "reply" },
				expected: "bun install",
				actual: [],
				evidence: [],
			},
			{
				id: "no-direct-install",
				status: "pass",
				assertion: { kind: "count" },
				expected: 0,
				actual: 0,
				evidence: [],
			},
		],
		events: [],
		reply: "Installed.",
		logs: "/tmp/run-1/logs",
		state: {},
		complete: [],
		reproduction: [],
	} as EvalDetail;

	it("opens with the directive, then the tally, the grid and each check that did not pass", () => {
		const text = evalsDonePrompt(grid, [failed]);

		expect(text.split("\n")[0]).toBe("[SPLATES EVALS DONE batch-abc]");
		expect(text).toContain("2 cells · 1 pass · 1 fail · 1,234 tokens · $0.42");
		expect(text).toContain("| `resources/install` | fail | pass |");
		expect(text).toContain("`install-card` (reply, fail)");
		expect(text).not.toContain("`no-direct-install`");
		expect(text).toContain('Reply: "Installed."');
		expect(text).toContain("/tmp/run-1/logs");
	});

	it("says every run passed when none held back", () => {
		expect(evalsDonePrompt(grid, [])).toContain("Every run passed.");
	});
});
