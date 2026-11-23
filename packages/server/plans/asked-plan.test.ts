import { describe, expect, it } from "bun:test";
import { stretches } from "./asked";

describe("stretches, a plan card", () => {
	it("reads a plan's title and body, its own headings and steps, up to the questions that decide it", () => {
		const text = [
			"Retrying failed scans needs a queue.",
			"",
			"## 📝 Plan: retry failed upload scans",
			"",
			"### Approach",
			"",
			"1. Add a column.",
			"2. Retry in the worker.",
			"",
			"```d2",
			"1. a -> b?",
			"```",
			"",
			"1. Should a failed scan notify the uploader?",
			"   - (a) Only after the last retry (chosen)",
			"   - (b) Every time",
			"2. Do you approve retrying failed upload scans?",
			"   - (a) Yes, approve it",
			"   - (b) No",
		].join("\n");
		const found = stretches(text);
		expect(found.map((each) => each.type)).toEqual([
			"text",
			"plan",
			"questions",
		]);
		const plan = found[1];
		expect(plan?.type === "plan" ? plan.plan : null).toEqual({
			title: "retry failed upload scans",
			body: [
				"### Approach",
				"",
				"1. Add a column.",
				"2. Retry in the worker.",
				"",
				"```d2",
				"1. a -> b?",
				"```",
			].join("\n"),
		});
		const asked = found[2];
		expect(
			asked?.type === "questions"
				? asked.questions.map((each) => each.number)
				: [],
		).toEqual(["1", "2"]);
	});

	it("ends a plan at the next card's title", () => {
		const found = stretches(
			["## 📝 Plan: a", "", "Body.", "", "## ✅ Done: nothing"].join("\n"),
		);
		expect(found.map((each) => each.type)).toEqual(["plan", "report"]);
	});

	it("reads a plan with no title after its word", () => {
		const found = stretches("## 📝 Plan\n\nBody.");
		expect(found[0]?.type === "plan" ? found[0].plan.title : null).toBe("");
	});
});
