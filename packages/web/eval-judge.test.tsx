import "./testing-dom";
import { afterEach, describe, expect, it } from "bun:test";
import {
	CheckedByCode,
	distinctJudges,
	JudgedBy,
	judgeDisplay,
} from "./eval-judge";
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

	it("takes Jev as TypeSafe's, bare or prefixed", () => {
		expect(judgeDisplay("jev")).toEqual({
			agent: "typesafe",
			name: "Jev",
			effort: null,
		});
		expect(judgeDisplay("typesafe:jev-latest@low")?.agent).toBe("typesafe");
		expect(judgeDisplay("jev:latest")?.name).toBe("Jev");
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

it("shows TypeSafe's pink mark for Jev", () => {
	const view = render(<JudgedBy judges={distinctJudges(["jev"])} />);
	expect(view.container.textContent).toContain("Jev");
	expect(view.container.querySelector('circle[fill="#E551BA"]')).not.toBeNull();
	expect(view.container.querySelector('path[fill="#D97757"]')).toBeNull();
});

it("says a code check graded the run when no model did", () => {
	const view = render(<CheckedByCode />);
	expect(view.container.textContent).toBe("Checked by code");
});
