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

	it("totals the bill, plan use at API prices apart, and opens a provider onto its services", async () => {
		const view = await testing.open();
		await act(async () =>
			fireEvent.click(view.getByRole("tab", { name: /Billing/ })),
		);
		await waitFor(() => view.getByLabelText("range"));
		await waitFor(() => view.getByText("Updated", { exact: false }));
		expect(view.getByLabelText("total").textContent).toContain("$203");
		expect(view.getByText(/\$12\.50 of plan use at API prices/)).toBeTruthy();
		expect(view.queryByText("Max 20x plan")).toBeNull();
		fireEvent.click(view.getByRole("button", { name: /Claude/ }));
		expect(view.getByText("Max 20x plan")).toBeTruthy();
		expect(view.queryByText("opus")).toBeNull();
		expect(view.getAllByText("expected").length).toBeGreaterThan(0);
	});

	it("splits the bill by project, provider bills and plan fees unassigned", async () => {
		const view = await testing.open();
		await act(async () =>
			fireEvent.click(view.getByRole("tab", { name: /Billing/ })),
		);
		await waitFor(() => view.getByLabelText("by project"));
		const rows = view.getByLabelText("by project").textContent ?? "";
		expect(rows).toContain("splates");
		expect(rows).toContain("$12.50 plan use");
		expect(rows).toMatch(/Unassigned.*\$203\.00/);
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
});
