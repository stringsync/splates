import { describe, expect, it } from "bun:test";
import { wordsOf } from "./candidates";

describe("wordsOf", () => {
	it("takes a queued task's first paragraph as its goal and the rest as details", () => {
		expect(
			wordsOf(
				"An upload stops retrying on a 413.\n\nThe client retries on any 4xx.\n\n- [ ] stop retrying",
			),
		).toEqual({
			goal: "An upload stops retrying on a 413.",
			details: "The client retries on any 4xx.\n\n- [ ] stop retrying",
		});
	});

	it("reads the goal under ## After in a task written before goals, or a plan", () => {
		const { goal, details } = wordsOf(
			"## Before\n\nIt loops forever.\n\n## After\n\nAn upload stops retrying on a 413.\n\nMore after.\n\n## Details\n\nIn `src/upload.ts`.",
		);
		expect(goal).toBe("An upload stops retrying on a 413.");
		expect(details).toContain("More after.");
		expect(details).toContain("It loops forever.");
		expect(details).toContain("src/upload.ts");
	});

	it("skips a leading heading to find the goal", () => {
		expect(wordsOf("# upload-413\n\nStop retrying.").goal).toBe(
			"Stop retrying.",
		);
	});

	it("has no goal for empty words", () => {
		expect(wordsOf("")).toEqual({ goal: "", details: "" });
	});
});
