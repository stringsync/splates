import { describe, expect, it } from "bun:test";
import { commentsText } from "./plan-comments";

describe("commentsText", () => {
	it("says nothing with no written comment", () => {
		expect(commentsText([])).toBe("");
		expect(commentsText([{ quote: "a", note: "  " }])).toBe("");
	});

	it("carries each comment with the text it quotes", () => {
		expect(
			commentsText([
				{ quote: "backfill\n it", note: "In a job?" },
				{ quote: "Risks", note: "Rollback?" },
			]),
		).toBe(
			[
				"> **Comments on the plan**",
				"- On “backfill it”: In a job?",
				"- On “Risks”: Rollback?",
			].join("\n\n"),
		);
	});
});
