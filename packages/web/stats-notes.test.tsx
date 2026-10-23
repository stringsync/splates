import { describe, expect, it } from "bun:test";
import type {
	Arm,
	ExperimentArm,
	NoteStats,
} from "@stringsync/splates-server/stats/browser";
import { NoteSection } from "./stats-notes";
import { render } from "./testing-library";

describe("NoteSection", () => {
	it("separates the new phase, shows missingness and keeps the review collecting until follow-up matures", () => {
		const page = render(
			<NoteSection
				notes={{
					...notes,
					experiment: {
						version: "notes-v2",
						followUpDays: 7,
						targetPerArm: 400,
						worthwhile: 0.05,
						pointed: phaseArm,
						holdout: phaseArm,
						difference: [-0.1, 0.2],
						decision: "collecting",
						models: [
							{
								agent: "codex",
								model: "model-a",
								pointed: phaseArm,
								holdout: phaseArm,
							},
						],
					},
				}}
			/>,
		);
		const section = page.getByRole("region", { name: "Notes" });
		expect(section.textContent).toContain("notes-v2 · 50/50");
		expect(section.textContent).toContain("first 400 assigned conversations");
		expect(section.textContent).toContain("Collecting data; no decision yet.");
		expect(section.textContent).toContain("-10.0 to +20.0 percentage points");
		expect(section.textContent).toContain("Historical experiment");
		expect(
			page.getByRole("row", { name: /Unknown correction outcome/ }).textContent,
		).toContain("2");
		expect(
			page.getByRole("row", { name: /codex \/ model-a/ }).textContent,
		).toContain("1/2 merges");
	});
	it("shows pointers against the holdout with each figure's count, and each note's read-through and applied rate", () => {
		const page = render(<NoteSection notes={notes} />);

		const section = page.getByRole("region", { name: "Notes" });
		expect(section.textContent).toContain("75% of 4");
		expect(section.textContent).toContain("1,500 of 2");
		expect(section.textContent).toContain("Pointed at on 25% of 8 messages");
		expect(section.textContent).toContain("900ms at the median");
		expect(
			page.getByRole("row", { name: /Turns per merged task/ }).textContent,
		).toContain("4.5 of 2");
		expect(
			page.getByRole("row", { name: /Messages correcting/ }).textContent,
		).toContain("20% of 10");
		expect(section.textContent).toContain(
			"The judge cost $0.003: $0.0024 routing 8 messages ($0.0003 each), $0.0006 weighing 4 notes read.",
		);
		expect(section.textContent).toContain(
			"Notes read took 5% of the context, about 1,500 tokens a conversation, over 2.",
		);
		const row = page.getByRole("row", { name: /notes\/x.md/ });
		expect(row.textContent).toContain("50% of 2");
		expect(row.textContent).toContain("75% of 4");
	});
});

const phaseArm: ExperimentArm = {
	assigned: 5,
	tasks: 3,
	mature: 3,
	pending: 2,
	corrected: 1,
	missing: 2,
	judgments: 5,
	failures: 2,
	spend: 0.01,
	p95: 500,
	reads: 4,
	applied: 2,
	inProgress: 1,
	merged: 2,
	removed: 0,
	firstTry: 2,
	used: 1,
	tokens: 100,
	turned: 1,
	turns: 3,
};

const arm: Arm = {
	conversations: 4,
	merged: 4,
	removed: 1,
	firstTry: 3,
	redone: 1,
	used: 2,
	tokens: 3000,
	turned: 2,
	turns: 9,
	said: 10,
	corrected: 2,
	checksPassed: 9,
	checksApplied: 10,
};

const notes: NoteStats = {
	projects: ["/repo"],
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
	spend: { routing: 0.0024, routed: 8, weighing: 0.0006, weighed: 4 },
	context: { conversations: 2, tokens: 3000, share: 0.05 },
	notes: [
		{
			project: "/repo",
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
