import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { act, cleanup, fireEvent, Testing, waitFor } from "./testing";

describe("App's billing unused quota", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
		testing.unusedQuotaReport = {
			days: 28,
			currency: "USD",
			totalUnusedMonthly: 180,
			totalPricedMonthly: 400,
			pricedPlans: 2,
			plans: [
				{
					provider: "codex",
					plan: "Pro plan",
					monthlyPrice: 200,
					window: "10080_minutes",
					resets: [
						{ resets: "2026-11-09T08:00:00.000Z", peak: 0.2, unused: 0.8 },
						{ resets: "2026-11-16T08:00:00.000Z", peak: 0.28, unused: 0.72 },
					],
					current: null,
					avgPeak: 0.24,
					maxPeak: 0.28,
					unusedShare: 0.76,
					unusedMonthly: 152,
					tierHint: "Peak fits Pro Lite ($100)",
					apiEquivalent: 48,
				},
				{
					provider: "antigravity",
					plan: null,
					monthlyPrice: null,
					window: "Weekly",
					resets: [
						{ resets: "2026-11-16T08:00:00.000Z", peak: 0.32, unused: 0.68 },
					],
					current: null,
					avgPeak: 0.32,
					maxPeak: 0.32,
					unusedShare: 0.68,
					unusedMonthly: null,
					tierHint: null,
					apiEquivalent: 0,
				},
			],
		};
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("shows the ranked unused quota card, tier-fit hint, and expands onto reset history", async () => {
		const view = await testing.open();
		await act(async () =>
			fireEvent.click(view.getByRole("tab", { name: /Billing/ })),
		);
		await waitFor(() => view.getByLabelText("unused quota"));

		const section = view.getByLabelText("unused quota");
		expect(section.textContent).toContain("~$180/mo");
		expect(section.textContent).toContain("45% of $400/mo unused");
		expect(section.textContent).toContain("~$152/mo unused");
		expect(section.textContent).toContain("Peak fits Pro Lite ($100)");
		expect(section.textContent).toContain("68% unused");
		expect(section.textContent).toContain("Price unknown");

		// Reset history is hidden until the row is expanded.
		expect(section.textContent).not.toContain("Nov 9 reset");
		fireEvent.click(view.getByRole("button", { name: /Codex.*Pro plan/ }));
		expect(section.textContent).toContain("Nov 9 reset");
		expect(section.textContent).toContain("20% used");
		expect(section.textContent).toContain("80% unused");
		expect(section.textContent).toContain("$48 API-price equiv.");
	});

	it("switches between 4-week and 90-day lookbacks", async () => {
		const view = await testing.open();
		await act(async () =>
			fireEvent.click(view.getByRole("tab", { name: /Billing/ })),
		);
		await waitFor(() => view.getByLabelText("unused quota window"));

		const ninety = view.getByRole("button", { name: "Last 90 days" });
		expect(ninety.getAttribute("aria-pressed")).toBe("false");
		await act(async () => fireEvent.click(ninety));
		expect(ninety.getAttribute("aria-pressed")).toBe("true");
	});
});
