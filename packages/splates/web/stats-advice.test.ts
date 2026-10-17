import { describe, expect, it } from "bun:test";
import { combine, type Tally } from "../stats";
import { advise, duration } from "./stats-advice";

/** A period where nothing ended; a test fills in what it is about. */
function period(changes: Partial<Tally> = {}): Tally {
	return { ...combine([]), ...changes };
}

/**
 * The card titled `title`, of what `advise` makes of `tally`, its `systems`
 * and the 12 weeks `previous` to it.
 */
function card(
	title: string,
	tally: Tally,
	systems: { system: string | null; tally: Tally }[] = [],
	previous: Tally | null = null,
) {
	return advise({ period: tally, previous, systems, span: "12 weeks" }).find(
		(each) => each.title === title,
	);
}

describe("advise", () => {
	it("says to let agents assume more when you rarely challenge them, and to ask more when you often do", () => {
		expect(
			card(
				"Assumptions you challenged",
				period({ assumptionsMade: 20, assumptionsChallenged: 1 }),
			),
		).toMatchObject({
			figure: "5%",
			act: expect.stringContaining("assume more"),
		});
		expect(
			card(
				"Assumptions you challenged",
				period({ assumptionsMade: 10, assumptionsChallenged: 4 }),
			)?.act,
		).toContain("assume wrong");
	});

	it("says to let agents decide when you almost always agree, and to give context when you often do not", () => {
		expect(
			card(
				"Picks you overturned",
				period({ picksAsked: 20, picksOverturned: 1 }),
			),
		).toMatchObject({
			figure: "5%",
			act: expect.stringContaining("without asking"),
		});
		expect(
			card(
				"Picks you overturned",
				period({ picksAsked: 10, picksOverturned: 4 }),
			),
		).toMatchObject({
			figure: "40%",
			act: expect.stringContaining("CLAUDE.md"),
		});
		expect(
			card(
				"Picks you overturned",
				period({ picksAsked: 10, picksOverturned: 2 }),
			)?.act,
		).toBeNull();
	});

	it("says how much more each card needs before it can say anything", () => {
		const few = period({ merged: 3, picksAsked: 4, timed: 3 });

		expect(card("Questions per task", few)?.short).toBe(
			"Needs 2 more tasks ended to say",
		);
		expect(card("Picks you overturned", few)?.short).toBe(
			"Needs 1 more question offering a pick to say",
		);
		expect(card("Questions by system", few)?.short).toContain("one system");
		// Nothing failed or was removed, so nothing is missing to say why.
		expect(card("Why merges failed", few)?.short).toBeNull();
		expect(card("Why tasks were removed", few)?.short).toBeNull();
		expect(card("Questions per task", period({ merged: 5 }))?.short).toBeNull();
	});

	it("says nothing to act on with too few picks to read", () => {
		expect(
			card(
				"Picks you overturned",
				period({ picksAsked: 2, picksOverturned: 2 }),
			),
		).toMatchObject({ figure: "100%", act: null });
		expect(card("Picks you overturned", period())?.figure).toBeNull();
	});

	it("says you set the pace when tasks spend most of their time waiting on you", () => {
		expect(
			card(
				"Time waiting on you",
				period({ timed: 6, waitedMs: 6 * 3_600_000, spentMs: 9 * 3_600_000 }),
			),
		).toMatchObject({
			figure: "67%",
			detail: expect.stringContaining("1.0h a task"),
			act: expect.stringContaining("batches"),
		});
	});

	it("names the system drawing the most questions once it has enough tasks", () => {
		const systems = [
			{ system: "mixer", tally: period({ merged: 5, questionRounds: 10 }) },
			{ system: "docs", tally: period({ merged: 5, questionRounds: 1 }) },
			{ system: "tiny", tally: period({ merged: 1, questionRounds: 9 }) },
		];

		expect(
			card(
				"Questions by system",
				period({ merged: 10, questionRounds: 11 }),
				systems,
			),
		).toMatchObject({
			system: "mixer",
			figure: "2.0",
			detail: "questions a task, against 1.1 overall",
			act: expect.stringContaining("draws the most questions"),
		});
	});

	it("reads the commonest reason merges failed and tasks were removed", () => {
		expect(
			card(
				"Why merges failed",
				period({
					failedMerges: 7,
					failedBy: { conflict: 5, tests_failed: 2, merge_failed: 0 },
				}),
			),
		).toMatchObject({ figure: "7", act: expect.stringContaining("one lane") });
		expect(
			card(
				"Why tasks were removed",
				period({
					removed: 6,
					removedFor: {
						unsaid: 0,
						redo: 5,
						superseded: 1,
						moot: 0,
						nothing: 0,
					},
				}),
			),
		).toMatchObject({ act: expect.stringContaining("smaller") });
	});

	it("says whether each figure moved since the weeks before, and whether that is better", () => {
		const before = period({
			merged: 10,
			questionRounds: 20,
			picksAsked: 10,
			picksOverturned: 4,
		});

		expect(
			card(
				"Questions per task",
				period({ merged: 10, questionRounds: 10 }),
				[],
				before,
			),
		).toMatchObject({
			figure: "1.0",
			trend: "Down from 2.0 the 12 weeks before: better",
			act: expect.stringContaining("need you less"),
		});
		expect(
			card(
				"Questions per task",
				period({ merged: 10, questionRounds: 30 }),
				[],
				before,
			),
		).toMatchObject({
			trend: "Up from 2.0 the 12 weeks before: worse",
			act: expect.stringContaining("need you more"),
		});
		expect(
			card(
				"Questions per task",
				period({ merged: 10, questionRounds: 21 }),
				[],
				before,
			),
		).toMatchObject({
			trend: "About the same as 2.0 the 12 weeks before",
			act: null,
		});
		expect(
			card(
				"Picks you overturned",
				period({ picksAsked: 10, picksOverturned: 1 }),
				[],
				before,
			)?.trend,
		).toBe("Down from 40% the 12 weeks before: better");
		expect(
			card(
				"Why merges failed",
				period({ merged: 10, failedMerges: 5 }),
				[],
				period({ merged: 10, failedMerges: 2 }),
			)?.trend,
		).toBe("0.5 a task, up from 0.2 the 12 weeks before: worse");
	});

	it("compares nothing for all time, or with too little before", () => {
		const now = period({ merged: 10, questionRounds: 10 });

		expect(card("Questions per task", now)).toMatchObject({
			trend: null,
			act: null,
		});
		expect(
			card(
				"Questions per task",
				now,
				[],
				period({ merged: 2, questionRounds: 8 }),
			)?.trend,
		).toBeNull();
	});

	it("says agents miss details when you often take their pick with words added", () => {
		expect(
			card(
				"Picks you overturned",
				period({ picksAsked: 10, picksOverturned: 0, picksAmended: 4 }),
			),
		).toMatchObject({
			detail: expect.stringContaining("4 more you took with words added"),
			act: expect.stringContaining("miss details"),
		});
	});
});

describe("duration", () => {
	it("reads in minutes, hours or days", () => {
		expect(
			[45 * 60_000, 3.2 * 3_600_000, 50 * 3_600_000].map(duration),
		).toEqual(["45m", "3.2h", "2.1d"]);
	});
});
