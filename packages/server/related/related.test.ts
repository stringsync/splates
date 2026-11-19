import { describe, expect, it } from "bun:test";
import type { Judge, Judgment } from "../auto-pick";
import type { Candidate } from "./candidates";
import { findRelated, relatedLines } from "./related";

describe("findRelated", () => {
	it("names what the judge calls related, most likely first, with its labels", async () => {
		const asked: Judgment[] = [];
		const found = await findRelated(
			query,
			pool,
			fake({ r0: 0.9, s0: 0.8, x0: 0.1, r1: 0.3 }, asked),
		);
		expect(found.judged).toBe(true);
		expect(found.pool).toBe(3);
		expect(found.related.map((each) => each.candidate.ref)).toEqual(["#1"]);
		expect(found.related[0]?.verdict).toEqual({
			related: 0.9,
			supersedes: 0.8,
			conflicts: 0.1,
		});
		// Only the shortlist goes, titles and goals but never details.
		const sent = JSON.stringify(asked[0]?.state);
		expect(sent).not.toContain("never sent");
		expect(sent).not.toContain("secret details");
		expect(sent).not.toContain("Billing");
		expect(Object.keys(asked[0]?.questions ?? {})).toEqual([
			"r0",
			"s0",
			"x0",
			"r1",
			"s1",
			"x1",
		]);
	});

	it("names as many as asked", async () => {
		const found = await findRelated(
			query,
			pool,
			fake({ r0: 0.9, r1: 0.8, r2: 0.7 }),
			{ shown: 2 },
		);
		expect(found.related).toHaveLength(2);
	});

	it("falls back to shared words when the judge fails, saying why", async () => {
		const found = await findRelated(query, pool, {
			judge: async () => {
				throw new Error("Jev answered 503");
			},
		});
		expect(found.judged).toEqual({ reason: "Jev answered 503" });
		expect(found.related.map((each) => each.candidate.ref)).toEqual(["#1"]);
		expect(found.related[0]?.verdict).toBeNull();
	});

	it("names nothing unjudged that shares too few words", async () => {
		const found = await findRelated(
			{ ...query, title: "", goal: "billing totals by plan for a year" },
			pool,
			null,
		);
		expect(found.related).toEqual([]);
	});

	it("prints each related task with its state, likelihood and labels", () => {
		const lines = relatedLines({
			related: [
				{
					candidate: pool[0] as Candidate,
					verdict: { related: 0.92, supersedes: 0.7, conflicts: 0.1 },
				},
			],
			pool: 3,
			judged: true,
		}).join("\n");
		expect(lines).toContain("related (1 of 3 tasks, judged by Jev)");
		expect(lines).toContain(
			"#1 queued 92%: Upload retries on a 413 response forever",
		);
		expect(lines).toContain("may supersede this task");
		expect(lines).not.toContain("may conflict");
	});

	it("prints that it looked when nothing is related", () => {
		expect(
			relatedLines({ related: [], pool: 9, judged: { reason: "no key" } }).join(
				"",
			),
		).toContain("none among 9 tasks");
	});
});

const task = (
	ref: string,
	title: string,
	extra: Partial<Candidate> = {},
): Candidate => ({
	ref,
	status: "merged",
	title,
	goal: "",
	details: "",
	files: [],
	...extra,
});

const query = {
	title: "Upload stops retrying on a 413",
	goal: "An upload stops retrying on a 413 and says the file is too big",
	details: "secret details",
	files: [],
};

const pool = [
	task("#1", "Upload retries on a 413 response forever", {
		status: "queued",
		goal: "Uploads stop retrying on a 413",
		details: "never sent",
	}),
	task("abc", "Upload form shows the file size"),
	task("def", "Billing shows the monthly total"),
];

/** A judge answering from `answers`, keeping what it was asked. */
function fake(answers: Record<string, number>, asked: Judgment[] = []): Judge {
	return {
		async judge(judgment) {
			asked.push(judgment);
			return { answers: new Map(Object.entries(answers)), dollars: 0.0001 };
		},
	};
}
