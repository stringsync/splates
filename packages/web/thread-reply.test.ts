import { describe, expect, test } from "bun:test";
import { beforeCard, beforeList, replied } from "./thread-reply";

describe("thread-reply", () => {
	test("cuts the text at a report title", () => {
		expect(beforeCard("Landed.\n\n## ✅ Merged x onto main\n\nBody")).toBe(
			"Landed.",
		);
	});

	test("keeps plain headings and fenced titles whole", () => {
		const text = "## Plan\n\n```\n## ✅ Merged x onto main\n```";
		expect(beforeCard(text)).toBe(text);
	});

	test("cuts the text at a list that already asks", () => {
		expect(beforeCard("Hm.\n\n1. Keep it?\n   - (a) yes")).toBe("Hm.");
		expect(beforeCard("1. first\n2. second")).toBe("1. first\n2. second");
	});

	test("folds a plan into the questions that decide it", () => {
		const parts = replied(
			[
				"## 📝 Plan: retry scans",
				"",
				"### Approach",
				"",
				"1. Retry in the worker.",
				"",
				"1. Do you approve retrying scans?",
				"   - (a) Yes, approve it",
				"   - (b) No",
			].join("\n"),
			true,
			{ task: null },
		);
		expect(parts.map((part) => part.type)).toEqual(["data-questions"]);
		expect((parts[0] as { data: { plan: unknown } }).data.plan).toEqual({
			title: "retry scans",
			body: "### Approach\n\n1. Retry in the worker.",
		});
	});

	test("leaves a plan no questions follow as its text", () => {
		expect(
			replied("## 📝 Plan: retry scans\n\nBody.", true, { task: null }),
		).toEqual([{ type: "text", text: "## 📝 Plan: retry scans\n\nBody." }]);
	});

	test("holds a card back while the agent writes", () => {
		const turn = { task: null };
		expect(replied("## 🔐 Permission: run command: x", false, turn)).toEqual(
			[],
		);
	});

	test("holds back a numbered list that runs to the end", () => {
		expect(beforeList("Hm.\n\n1. Keep it?\n   - (a) yes")).toBe("Hm.");
		expect(beforeList("Hm.\n\n1. Keep")).toBe("Hm.");
	});

	test("frees a list that prose follows, and a fenced one", () => {
		const prose = "1. one\n2. two\n\nThat is all.";
		expect(beforeList(prose)).toBe(prose);
		const fenced = "```\n1. one\n";
		expect(beforeList(fenced)).toBe(fenced);
	});

	test("drops a heading that only titles the questions after it", () => {
		const turn = { task: null };
		const parts = replied(
			"Plan.\n\n## 🔐 Questions\n\n1. Keep it?\n   - (a) Yes (chosen)",
			true,
			turn,
		);
		expect(parts.map((part) => part.type)).toEqual(["text", "data-questions"]);
		expect(parts[0]).toEqual({ type: "text", text: "Plan." });
		const alone = replied(
			"## 🔐 Questions\n\n1. Keep it?\n   - (a) Yes",
			true,
			turn,
		);
		expect(alone.map((part) => part.type)).toEqual(["data-questions"]);
	});
});
