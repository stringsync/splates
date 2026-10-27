import { describe, expect, it } from "bun:test";
import type { SpendTotal } from "@stringsync/splates-server/spend";
import {
	byProvider,
	colorOf,
	everyDay,
	monthEnd,
	projected,
	spanOf,
	spanTitle,
} from "./billing-sums";

const row = (over: Partial<SpendTotal>): SpendTotal => ({
	provider: "claude",
	service: null,
	period: null,
	billed: 0,
	equivalent: 0,
	...over,
});

describe("billing sums", () => {
	it("groups services by provider, the costliest of each first", () => {
		const grouped = byProvider([
			row({ service: "haiku", equivalent: 1 }),
			row({ provider: "openai", service: "whisper", billed: 5 }),
			row({ service: "opus", equivalent: 3 }),
		]);
		expect(
			grouped.map((each) => [each.provider, each.billed, each.equivalent]),
		).toEqual([
			["openai", 5, 0],
			["claude", 0, 4],
		]);
		expect(grouped[1]?.services.map((each) => each.service)).toEqual([
			"opus",
			"haiku",
		]);
	});

	it("gives every day of the range its place, spent or not", () => {
		const days = everyDay(
			[
				row({ period: "2026-10-02", equivalent: 2 }),
				row({ provider: "openai", period: "2026-10-02", billed: 1 }),
			],
			"2026-10-01T00:00:00.000Z",
			"2026-10-04T00:00:00.000Z",
		);
		expect(days.map((each) => [each.day, each.total])).toEqual([
			["2026-10-01", 0],
			["2026-10-02", 3],
			["2026-10-03", 0],
		]);
	});

	it("projects the month at the pace so far, and not in its first day", () => {
		// Ten of October's 31 days gone.
		expect(projected(10, Date.parse("2026-10-11T00:00:00Z"))).toBeCloseTo(31);
		expect(projected(10, Date.parse("2026-10-01T12:00:00Z"))).toBeNull();
		expect(monthEnd(Date.parse("2026-02-10T00:00:00Z"))).toBe("Feb 28");
	});

	it("keeps a provider's color whatever else is in range", () => {
		expect(colorOf("openai")).toBe("var(--series-4)");
		expect(colorOf("somewhere")).toBe("var(--muted-foreground)");
	});

	it("steps a span back a whole span at a time", () => {
		const now = Date.parse("2026-10-21T15:00:00Z");
		expect(spanOf("day", now, 1)).toEqual({
			since: "2026-10-20T00:00:00.000Z",
			until: "2026-10-21T00:00:00.000Z",
		});
		expect(spanOf("week", now, 1)).toEqual({
			since: "2026-10-08T00:00:00.000Z",
			until: "2026-10-15T00:00:00.000Z",
		});
		expect(spanOf("month", now)).toEqual({
			since: "2026-10-01T00:00:00.000Z",
			until: "2026-10-22T00:00:00.000Z",
		});
		expect(spanOf("month", now, 10)).toEqual({
			since: "2025-12-01T00:00:00.000Z",
			until: "2026-01-01T00:00:00.000Z",
		});
	});

	it("names a span the page has stepped back to", () => {
		const now = Date.parse("2026-10-21T15:00:00Z");
		expect(spanTitle("day", now, 0)).toBe("Today");
		expect(spanTitle("day", now, 1)).toBe("Yesterday");
		expect(spanTitle("day", now, 2)).toBe("Oct 19");
		expect(spanTitle("week", now, 1)).toBe("Oct 8 to Oct 14");
		expect(spanTitle("month", now, 1)).toBe("September 2026");
	});
});
