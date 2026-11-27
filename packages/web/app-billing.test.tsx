import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { act, cleanup, fireEvent, Testing, waitFor } from "./testing";

describe("App's billing spend", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
		testing.spendReport = {
			updated: "2026-10-21T12:00:00.000Z",
			currency: "USD",
			rateDate: null,
			rateError: null,
			services: [
				{
					provider: "claude",
					service: "opus",
					period: null,
					billed: 0,
					equivalent: 12.5,
					expected: 0,
				},
				{
					provider: "claude",
					service: "Max 20x plan",
					period: null,
					billed: 0,
					equivalent: 0,
					expected: 200,
				},
				{
					provider: "openai",
					service: "whisper",
					period: null,
					billed: 3,
					equivalent: 0,
					expected: 0,
				},
			],
			days: [
				{
					provider: "claude",
					service: null,
					period: "2026-10-21",
					billed: 0,
					equivalent: 12.5,
					expected: 0,
				},
			],
			projects: [
				{ project: "splates", billed: 0, equivalent: 12.5, expected: 0 },
				{ project: null, billed: 3, equivalent: 0, expected: 200 },
			],
			upcoming: [],
		};
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("totals the bill, compares actual against API prices, and opens a provider onto its plan and model services", async () => {
		testing.spendReport.services[0] = {
			provider: "claude",
			service: "opus",
			period: null,
			billed: 0,
			equivalent: 500,
			expected: 0,
		};
		const view = await testing.open();
		await act(async () =>
			fireEvent.click(view.getByRole("tab", { name: /Billing/ })),
		);
		await waitFor(() => view.getByLabelText("range"));
		await waitFor(() => view.getByText("Updated", { exact: false }));
		const total = view.getByLabelText("total");
		expect(total.textContent).toContain("$203");
		expect(total.textContent).toContain("Actual bill vs. API list prices");
		expect(total.textContent).toContain("$503.00");
		expect(total.textContent).toContain("Saving $300.00");
		expect(view.queryByText("Max 20x plan")).toBeNull();
		fireEvent.click(view.getByRole("button", { name: /Claude/ }));
		expect(view.getByText("Max 20x plan")).toBeTruthy();
		expect(view.getByText("opus")).toBeTruthy();
		expect(view.getAllByText("expected").length).toBeGreaterThan(0);
	});

	it("steps the range back a month and forward again, never past today", async () => {
		const view = await testing.open();
		await act(async () =>
			fireEvent.click(view.getByRole("tab", { name: /Billing/ })),
		);
		await waitFor(() => view.getByLabelText("total"));
		const title = () => view.getByLabelText("total").textContent ?? "";
		expect(title()).toContain("This month");
		const later = () => view.getByRole("button", { name: "later" });
		expect(later().hasAttribute("disabled")).toBe(true);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "earlier" })),
		);
		expect(title()).not.toContain("This month");
		expect(title()).toMatch(/[A-Z][a-z]+ \d{4}/);
		expect(later().hasAttribute("disabled")).toBe(false);
		await act(async () => fireEvent.click(later()));
		expect(title()).toContain("This month");
	});

	it("places Plan limits inside Spend right below the spend summary card", async () => {
		testing.unusedQuotaReport = {
			days: 28,
			currency: "USD",
			totalUnusedMonthly: 100,
			totalPricedMonthly: 200,
			pricedPlans: 1,
			plans: [
				{
					provider: "claude",
					plan: "Max 20x",
					monthlyPrice: 200,
					window: "seven_day",
					resets: [],
					current: null,
					avgPeak: null,
					maxPeak: null,
					unusedShare: null,
					unusedMonthly: null,
					tierHint: null,
					apiEquivalent: 0,
				},
			],
		};
		const view = await testing.open();
		await act(async () =>
			fireEvent.click(view.getByRole("tab", { name: /Billing/ })),
		);
		await waitFor(() => view.getByLabelText("unused quota"));

		const spend = view.getByRole("region", { name: "spend" });
		const total = view.getByLabelText("total");
		const planLimits = view.getByRole("heading", { name: "Plan limits" });
		const unused = view.getByLabelText("unused quota");
		expect(spend.contains(planLimits)).toBe(true);
		expect(
			total.compareDocumentPosition(planLimits) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		expect(
			planLimits.compareDocumentPosition(unused) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
	});
});
