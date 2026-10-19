import { describe, expect, it } from "bun:test";
import { tool } from "./fixtures";
import { stretchesOf, type Work, worked } from "./work";
import { liveWorkingSpan, workingSpan } from "./work-time";

describe("permission wait timing", () => {
	it("freezes while waiting and excludes completed waits after resuming", () => {
		expect(workingSpan(work(at(40)), at(50))).toBe("20s");
		expect(workingSpan(work(at(40)), at(90))).toBe("20s");
		expect(workingSpan(work(), at(50))).toBe("30s");
		expect(worked(work())).toBe("Worked 1m 20s");
	});
	it("clips waits to the row and does not double-count overlaps", () => {
		const row = work();
		row.at = at(20);
		row.waits = [
			{ from: at(10), to: at(30) },
			{ from: at(25), to: at(40) },
			{ from: at(70), to: at(90) },
		];
		expect(workingSpan(row, at(50))).toBe("10s");
	});
	it("keeps older logs without request timestamps readable", () => {
		const row = work();
		row.waits = [];
		expect(workingSpan(row, at(50))).toBe("50s");
	});
	it("freezes after thirty seconds of silence and catches up on a fresh update", () => {
		const row = work();
		row.waits = [];
		row.until = at(10);
		expect(liveWorkingSpan(row, 20_000)).toBe("20s");
		expect(liveWorkingSpan(row, 90_000)).toBe("40s");
		expect(liveWorkingSpan(row, 120_000)).toBe("40s");
		row.until = at(120);
		expect(liveWorkingSpan(row, 121_000)).toBe("2m 1s");
	});
	it("counts a row opened after the agent's last update from its start", () => {
		const row = work();
		row.waits = [];
		row.at = at(20);
		row.until = at(10);
		expect(liveWorkingSpan(row, 35_000)).toBe("15s");
		expect(liveWorkingSpan(row, 120_000)).toBe("30s");
	});
	it("still excludes permission waits while activity is stale", () => {
		const row = work(at(40));
		expect(liveWorkingSpan(row, 300_000)).toBe("20s");
	});
	it("starts fresh live work after a trailing claim event", () => {
		const stretches = stretchesOf(
			{
				role: "agent",
				at: at(0),
				until: at(10),
				plan: null,
				parts: [tool({ at: at(0), until: at(5) })],
			},
			at(0),
			true,
			Infinity,
			[
				{
					id: "claim",
					at: at(8),
					action: "claim",
					task: "alpha",
					reason: null,
					conversation: "c1",
					goal: "Do the work.",
				},
			],
		);
		expect(stretches.map((stretch) => stretch.type)).toEqual([
			"work",
			"event",
			"work",
		]);
		const rows = stretches.flatMap((stretch) =>
			stretch.type === "work" ? [stretch.work] : [],
		);
		expect(rows[0]?.working).toBe(false);
		expect(rows[0]?.running).toBe(false);
		expect(rows[0]?.until).toBe(at(8));
		expect(rows[1]?.working).toBe(true);
		expect(rows[1]?.at).toBe(at(8));
		expect(rows[1]?.parts).toEqual([]);
	});
	it("never says Working above a merge line the reply came after", () => {
		const stretches = stretchesOf(
			{
				role: "agent",
				at: at(0),
				until: at(10),
				plan: null,
				parts: [
					tool({ at: at(0), until: at(5) }),
					{ type: "text", text: "Merged.", at: at(9) },
				],
			},
			at(0),
			true,
			Infinity,
			[
				{
					id: "merge",
					at: at(5),
					action: "merge",
					task: "alpha",
					reason: null,
					conversation: "c1",
					base: "main",
					commit: "abc123",
					files: [],
					attemptsLeft: 3,
					failedTests: [],
				},
			],
		);
		expect(stretches.map((stretch) => stretch.type)).toEqual([
			"work",
			"event",
			"said",
		]);
		const [row] = stretches.flatMap((stretch) =>
			stretch.type === "work" ? [stretch.work] : [],
		);
		expect(row?.working).toBe(false);
		expect(row?.until).toBe(at(5));
	});
});

const at = (seconds: number) => new Date(seconds * 1000).toISOString();
const work = (waiting: string | null = null): Work => {
	const stretches = stretchesOf(
		{
			role: "agent",
			at: at(0),
			until: at(100),
			plan: null,
			parts: [
				tool({
					at: at(0),
					decision: { askedAt: at(10), at: at(30), option: null },
				}),
			],
		},
		at(0),
		true,
		Infinity,
		[],
		waiting,
	);
	const row = stretches.find((stretch) => stretch.type === "work");
	if (row?.type !== "work") {
		throw new Error("Missing work row");
	}
	return row.work;
};
