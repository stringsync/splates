import { describe, expect, it } from "bun:test";
import type { SpendTotal } from "@splates/server/spend";
import {
	apiTotal,
	byProvider,
	colorOf,
	everyDay,
	missingPlans,
	monthEnd,
	nameOf,
	plansInProjection,
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
	expected: 0,
	...over,
});

describe("billing sums", () => {
	it("groups services by provider, including API-equivalent plan use, the costliest actual bill first", () => {
		const grouped = byProvider([
			row({ service: "Pro plan", expected: 20 }),
			row({ provider: "openai", service: "whisper", billed: 5 }),
			row({ service: "Max 20x plan", expected: 200 }),
			row({ service: "opus", equivalent: 3 }),
			row({
				provider: "antigravity",
				service: "gemini-4-neon",
				equivalent: 12,
			}),
		]);
		expect(
			grouped.map((each) => [
				each.provider,
				each.billed,
				each.expected,
				each.equivalent,
				apiTotal(each),
			]),
		).toEqual([
			["claude", 0, 220, 3, 3],
			["openai", 5, 0, 0, 5],
			["antigravity", 0, 0, 12, 12],
		]);
		expect(grouped[0]?.services.map((each) => each.service)).toEqual([
			"Max 20x plan",
			"Pro plan",
			"opus",
		]);
	});

	it("gives every day of the range its place, with what it put on the bill", () => {
		const days = everyDay(
			[
				row({ period: "2026-10-02", expected: 2 }),
				row({ period: "2026-10-02", equivalent: 9 }),
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
		expect(colorOf("kimi")).toBe("var(--series-3)");
		expect(colorOf("openai")).toBe("var(--series-5)");
		expect(colorOf("antigravity")).toBe("var(--series-8)");
		expect(nameOf("kimi")).toBe("Kimi");
		expect(nameOf("antigravity")).toBe("Antigravity");
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

	it("adds up each provider's plan fees, charged and still to come, biggest first", () => {
		expect(
			plansInProjection(
				[
					row({ service: "Max 5x plan", expected: 100 }),
					row({ equivalent: 9 }),
				],
				[
					row({ provider: "kimi", service: "Max plan", expected: 99 }),
					row({ provider: "codex", service: "Pro Lite plan", expected: 100 }),
				],
			),
		).toEqual([
			{ provider: "claude", amount: 100 },
			{ provider: "codex", amount: 100 },
			{ provider: "kimi", amount: 99 },
		]);
	});

	it("names providers with plan usage but no plan", () => {
		const plan = (provider: string, source: "none" | "detected") =>
			({ provider, source }) as never;
		expect(
			missingPlans(
				[
					row({ provider: "antigravity", equivalent: 38 }),
					row({ provider: "kimi", equivalent: 5 }),
				],
				[
					plan("antigravity", "none"),
					plan("kimi", "detected"),
					plan("codex", "none"),
				],
			),
		).toEqual(["antigravity"]);
	});
});
