import { describe, expect, it } from "bun:test";
import { decisions, questions } from "./plan";

describe("decisions", () => {
	it("keeps each call's size apart from its line, and what became of its pick", () => {
		const plan = [
			"## Assumptions",
			"",
			"- [ ] 1. (small) Retry limit?",
			"  - (a) Three (chosen)",
			"",
			"## Blocked",
			"",
			"- [x] 2. (large) Keep the endpoint? → b",
			"  - (a) Keep (chosen)",
			"  - (b) Drop",
			"- [x] 3. (medium) Name it? → challenged: call it mixer",
			"  - (a) Mixer (chosen)",
			"- [x] 4. (huge) Which store? → a, and shard it",
			"  - (a) Postgres (chosen)",
			"- [ ] 5. What looks wrong?",
		].join("\n");
		expect(questions(plan)[0]).toMatchObject({
			text: "Keep the endpoint?",
			size: "large",
		});
		expect(decisions(plan)).toEqual([
			{
				number: "1",
				text: "Retry limit?",
				size: "small",
				how: "assumed",
				ended: "kept",
			},
			{
				number: "2",
				text: "Keep the endpoint?",
				size: "large",
				how: "asked",
				ended: "overturned",
			},
			{
				number: "3",
				text: "Name it?",
				size: "medium",
				how: "assumed",
				ended: "challenged",
			},
			// A word the scheme does not name still reads as the size it was written with.
			{
				number: "4",
				text: "Which store?",
				size: "huge",
				how: "asked",
				ended: "amended",
			},
			{
				number: "5",
				text: "What looks wrong?",
				size: null,
				how: "asked",
				ended: null,
			},
		]);
	});
});
