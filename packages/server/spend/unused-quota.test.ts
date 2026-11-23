import { describe, expect, it } from "bun:test";
import { MemoryStorage } from "../storage/testing";
import { Spend } from "./spend";
import { unusedQuotaReport } from "./unused-quota";

describe("unusedQuotaReport", () => {
	it("ranks subscriptions by unused dollars, flags tier-fit hints, and leaves unpriced plans without dollar estimates", async () => {
		const ledger = new Spend(new MemoryStorage());
		await ledger.record(
			{
				at: "2026-11-10T12:00:00.000Z",
				provider: "codex",
				service: "gpt-5",
				kind: "equivalent",
				dollars: 48,
				project: "mono",
				task: null,
				conversation: null,
			},
			{
				at: "2026-11-12T12:00:00.000Z",
				provider: "claude",
				service: "opus",
				kind: "equivalent",
				dollars: 490,
				project: "mono",
				task: null,
				conversation: null,
			},
		);

		const report = await unusedQuotaReport({
			days: 28,
			now: "2026-11-23T12:00:00.000Z",
			ledger,
			plans: [
				{
					provider: "claude",
					service: "Max 20x plan",
					amount: 200,
					currency: "USD",
					everyMonths: 1,
					since: "2026-01-01T00:00:00.000Z",
				},
				{
					provider: "codex",
					service: "Pro plan",
					amount: 200,
					currency: "USD",
					everyMonths: 1,
					since: "2026-01-01T00:00:00.000Z",
				},
			],
			peaks: {
				claude: [
					{
						window: "five_hour",
						resets: "2026-11-20T15:00:00.000Z",
						peak: 0.2,
						lastAt: "2026-11-20T14:00:00.000Z",
					},
					{
						window: "seven_day",
						resets: "2026-11-09T09:00:00.000Z",
						peak: 0.88,
						lastAt: "2026-11-09T08:00:00.000Z",
					},
					{
						window: "seven_day",
						resets: "2026-11-16T09:00:00.000Z",
						peak: 0.84,
						lastAt: "2026-11-16T08:00:00.000Z",
					},
				],
				codex: [
					{
						window: "10080_minutes",
						resets: "2026-11-09T08:00:00.000Z",
						peak: 0.2,
						lastAt: "2026-11-09T07:00:00.000Z",
					},
					{
						window: "10080_minutes",
						resets: "2026-11-16T08:00:00.000Z",
						peak: 0.28,
						lastAt: "2026-11-16T07:00:00.000Z",
					},
				],
				antigravity: [
					{
						window: "Gemini · Weekly",
						resets: "2026-11-09T08:00:00.000Z",
						peak: 0.3,
						lastAt: "2026-11-09T07:00:00.000Z",
					},
					{
						window: "Claude · Weekly",
						resets: "2026-11-09T08:00:00.000Z",
						peak: 0.34,
						lastAt: "2026-11-09T07:00:00.000Z",
					},
					{
						window: "Gemini · Weekly",
						resets: "2026-11-16T08:00:00.000Z",
						peak: 0.3,
						lastAt: "2026-11-16T07:00:00.000Z",
					},
				],
			},
		});

		expect(report.pricedPlans).toBe(2);
		expect(report.totalPricedMonthly).toBe(400);
		expect(report.totalUnusedMonthly).toBe(180);
		expect(report.plans.map((each) => each.provider)).toEqual([
			"codex",
			"claude",
			"antigravity",
		]);

		const [codex, claude, antigravity] = report.plans;
		expect(codex?.unusedMonthly).toBe(152);
		expect(codex?.tierHint).toBe("Peak fits Pro Lite ($100)");
		expect(codex?.apiEquivalent).toBe(48);

		expect(claude?.unusedMonthly).toBe(28);
		expect(claude?.tierHint).toBeNull();

		expect(antigravity?.monthlyPrice).toBeNull();
		expect(antigravity?.unusedMonthly).toBeNull();
		expect(antigravity?.unusedShare).toBeCloseTo(0.68, 2);
	});

	it("reports an in-progress current cycle before the first reset completes", async () => {
		const ledger = new Spend(new MemoryStorage());
		const report = await unusedQuotaReport({
			days: 28,
			now: "2026-11-23T12:00:00.000Z",
			ledger,
			plans: [
				{
					provider: "codex",
					service: "Pro plan",
					amount: 200,
					currency: "USD",
					everyMonths: 1,
					since: "2026-01-01T00:00:00.000Z",
				},
			],
			peaks: {
				codex: [
					{
						window: "10080_minutes",
						resets: "2026-11-26T08:00:00.000Z",
						peak: 0.21,
						lastAt: "2026-11-23T11:00:00.000Z",
					},
				],
			},
		});

		expect(report.pricedPlans).toBe(0);
		expect(report.totalUnusedMonthly).toBe(0);
		expect(report.plans[0]?.resets).toEqual([]);
		expect(report.plans[0]?.current).toEqual({
			used: 0.21,
			resets: "2026-11-26T08:00:00.000Z",
		});
	});
});
