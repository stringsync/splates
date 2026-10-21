import "./register-dom";
import { describe, expect, it } from "bun:test";
import type { Arm, NoteStats } from "@stringsync/splates-server/stats/browser";
import { render } from "@testing-library/react";
import { NoteSection } from "./stats-notes";

const arm: Arm = {
	conversations: 4,
	merged: 4,
	removed: 1,
	firstTry: 3,
	redone: 1,
	used: 2,
	tokens: 3000,
	checksPassed: 9,
	checksApplied: 10,
};

describe("NoteSection", () => {
	it("shows pointers against the holdout with each figure's count, and each note's read-through and applied rate", () => {
		const notes: NoteStats = {
			pointed: arm,
			holdout: {
				...arm,
				conversations: 0,
				merged: 0,
				removed: 0,
				used: 0,
				checksApplied: 0,
			},
			messages: 8,
			attached: 2,
			p50: 900,
			p95: 2100,
			notes: [
				{
					path: "notes/x.md",
					now: 2,
					optional: 0,
					nowRead: 1,
					optionalRead: 0,
					unprompted: 3,
					judged: 4,
					applied: 3,
				},
			],
		};

		const page = render(<NoteSection notes={notes} />);

		const section = page.getByRole("region", { name: "Notes" });
		expect(section.textContent).toContain("75% of 4");
		expect(section.textContent).toContain("1,500 of 2");
		expect(section.textContent).toContain("Pointed at on 25% of 8 messages");
		expect(section.textContent).toContain("900ms at the median");
		const row = page.getByRole("row", { name: /notes\/x.md/ });
		expect(row.textContent).toContain("50% of 2");
		expect(row.textContent).toContain("75% of 4");
	});
});
