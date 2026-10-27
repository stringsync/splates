import { describe, expect, it } from "bun:test";
import { evalsDonePrompt } from "./done";
import type { EvalDetail, EvalGrid } from "./types";

describe("evalsDonePrompt", () => {
	const claude = {
		key: "native-claude@4/sonnet",
		agent: "native-claude@4",
		model: "sonnet",
		effort: null,
		skill: null,
	};
	const codex = {
		key: "native-codex@4/gpt",
		agent: "native-codex@4",
		model: "gpt",
		effort: null,
		skill: null,
	};
	const run = (id: string, status: "pass" | "fail") => ({
		id,
		status,
		tokens: 10,
		costUsd: 0.01,
		milliseconds: 1,
	});
	const grid: EvalGrid = {
		id: "batch-abc",
		skill: "splates",
		producer: "splates",
		startedAt: "2026-10-25T00:00:00.000Z",
		targets: [claude, codex],
		tally: { pass: 1, fail: 1 },
		cells: 2,
		tokens: 1234,
		costUsd: 0.42,
		grid: [
			{
				scenario: "resources/install",
				aspect: "resource-control",
				requirement: "host-heavy-work",
				target: claude.key,
				repetition: 0,
				run: run("batch-abc#run-1", "fail"),
			},
			{
				scenario: "resources/install",
				aspect: "resource-control",
				requirement: "host-heavy-work",
				target: codex.key,
				repetition: 0,
				run: run("batch-abc#run-2", "pass"),
			},
		],
	};
	const failed: EvalDetail = {
		...run("batch-abc#run-1", "fail"),
		producer: "splates",
		scenario: "resources/install",
		aspect: "resource-control",
		requirement: "Ask before installing.",
		target: claude,
		repetition: 0,
		input: "Install.",
		rubric: null,
		checks: [
			{ id: "asked", about: "ended with a run-command card", pass: false },
			{ id: "not-installed", about: "never installed", pass: true },
		],
		judge: { pass: false, reason: "it installed without asking" },
		reply: "Installed.",
		transcript: [],
	};

	it("opens with the directive, then the tally, the grid and each check that did not pass", () => {
		const text = evalsDonePrompt(grid, [failed]);

		expect(text.split("\n")[0]).toBe("[SPLATES EVALS DONE batch-abc]");
		expect(text).toContain("2 cells · 1 pass · 1 fail · 1,234 tokens · $0.42");
		expect(text).toContain("| `resources/install` | fail | pass |");
		expect(text).toContain("Check `asked`: ended with a run-command card");
		expect(text).not.toContain("`not-installed`");
		expect(text).toContain("Judge: it installed without asking");
		expect(text).toContain('Reply: "Installed."');
		expect(text).toContain(
			"Run: `batch-abc#run-1`, in full with `splates dev eval show batch-abc#run-1`",
		);
	});

	it("gives repetitions as a pass rate and lists errors apart from failures", () => {
		const cell = (repetition: number, status: "pass" | "fail" | "error") => ({
			scenario: "resources/install",
			aspect: "resource-control",
			requirement: "host-heavy-work",
			target: claude.key,
			repetition,
			run: {
				...run(`batch-abc#run-${repetition}`, "pass"),
				status,
			},
		});
		const text = evalsDonePrompt(
			{
				...grid,
				targets: [claude],
				grid: [cell(0, "pass"), cell(1, "fail"), cell(2, "error")],
			},
			[
				failed,
				{
					...failed,
					id: "batch-abc#run-2",
					status: "error",
					error: "model not found",
					repetition: 2,
				},
			],
		);

		expect(text).toContain("| `resources/install` | 1/2 pass, 1 error |");
		expect(text).toMatch(
			/Not passing:\n\n- `resources\/install` on .*: fail\n/,
		);
		expect(text).toMatch(
			/Errors, the harness's or the setup's, never the skill's:\n\n- `resources\/install` on .*repetition 3: error\n(.*\n)* {2}- Error: model not found/,
		);
	});

	it("says every run passed when none held back", () => {
		expect(evalsDonePrompt(grid, [])).toContain("Every run passed.");
	});
});
