import { describe, expect, it } from "bun:test";
import { tool } from "./fixtures";
import { stretchesOf, type Work, worked } from "./work";
import { workingSpan } from "./work-time";

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
