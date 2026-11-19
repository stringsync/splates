import { describe, expect, it } from "bun:test";
import type { Candidate } from "./candidates";
import { rank, words } from "./score";

describe("rank", () => {
	it("compares words split from paths and camel case, drops common words and plurals", () => {
		expect(words("The TaskOverlaps in tasks/overlaps.ts")).toEqual([
			"task",
			"overlap",
			"task",
			"overlap",
		]);
	});

	const pool = [
		task("a", "Staging's header drops the amber rule"),
		task("b", "Uploads retry on a 413", { status: "queued" }),
		task("c", "Billing shows the monthly total"),
	];

	it("puts the task sharing the most telling words first, and leaves out those sharing none", () => {
		const ranked = rank(query("Stop the upload retrying on a 413"), pool, 10);
		expect(ranked.map((each) => each.candidate.ref)).toEqual(["b"]);
		expect(ranked[0]?.matched).toBe(2);
	});

	it("ranks by words alone, whatever the task's state", () => {
		const twins = [
			task("merged", "Staging header badge", { status: "merged" }),
			task("queued", "Staging header badge", { status: "queued" }),
		];
		const [one, two] = rank(query("staging header badge"), twins, 10);
		expect(one?.score).toBe(two?.score as number);
	});

	it("counts a shared file path as words", () => {
		const ranked = rank(
			query("overlap warnings name more tasks"),
			[task("a", "Something else", { files: ["server/tasks/overlaps.ts"] })],
			10,
		);
		expect(ranked).toHaveLength(1);
	});

	it("keeps at most the limit", () => {
		expect(rank(query("staging upload billing"), pool, 2)).toHaveLength(2);
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

function query(goal: string) {
	return { title: "", goal, details: "", files: [] as string[] };
}
