import "./testing-dom";
import { afterEach, describe, expect, it } from "bun:test";
import type { EvalDetail, EvalFailure } from "@splates/server/evals/browser";
import {
	CheckedByCode,
	distinctJudges,
	JudgedBy,
	judgeDisplay,
} from "./eval-judge";
import { failureGrader } from "./eval-spec-data";
import { cleanup, render } from "./testing";

afterEach(cleanup);

describe("judgeDisplay", () => {
	it("reads a judge as evals write it, with its effort", () => {
		expect(judgeDisplay("claude:sonnet@high")).toEqual({
			agent: "claude",
			name: "Sonnet",
			effort: "high",
		});
		expect(judgeDisplay("claude:opus")).toEqual({
			agent: "claude",
			name: "Opus",
			effort: null,
		});
	});

	it("takes a bare model as Claude's, and nothing as no judge", () => {
		expect(judgeDisplay("haiku")?.agent).toBe("claude");
		expect(judgeDisplay(undefined)).toBeNull();
		expect(judgeDisplay("  ")).toBeNull();
	});
});

describe("distinctJudges", () => {
	it("names each judge once, in the order first named", () => {
		expect(
			distinctJudges([
				"claude:sonnet",
				undefined,
				"claude:opus@high",
				"claude:sonnet",
			]).map((judge) => judge.name),
		).toEqual(["Sonnet", "Opus"]);
	});
});

it("shows the judge's colored mark beside its name and effort", () => {
	const view = render(
		<JudgedBy judges={distinctJudges(["claude:haiku@low"])} />,
	);
	expect(view.container.textContent).toContain("Judged by");
	expect(view.container.textContent).toContain("Haiku");
	expect(view.container.textContent).toContain("low effort");
	expect(view.container.querySelector('path[fill="#D97757"]')).not.toBeNull();
});

it("says a code check graded the run when no model did", () => {
	const view = render(<CheckedByCode />);
	expect(view.container.textContent).toBe("Checked by code");
});

describe("failureGrader", () => {
	const failure: EvalFailure = {
		kind: "undiagnosed",
		runs: ["r1"],
		check: null,
		causes: [],
		why: null,
		did: null,
		remedy: null,
	};
	const ungraded = {
		checks: [],
		judge: null,
	} as unknown as EvalDetail;

	it("puts a failed rubric down to the judge", () => {
		const detail = {
			...ungraded,
			judge: { pass: false, reason: "no", judge: "claude:sonnet" },
		};
		expect(failureGrader(detail, failure)).toBe("judge");
		expect(failureGrader(ungraded, { ...failure, check: "judge" })).toBe(
			"judge",
		);
	});

	it("puts a failed code check down to code, before the judge", () => {
		const detail = {
			...ungraded,
			checks: [{ id: "c", about: "a", pass: false }],
			judge: { pass: false, reason: "no" },
		};
		expect(failureGrader(detail, failure)).toBe("code");
	});
});
