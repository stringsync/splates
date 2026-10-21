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
				},
				{
					provider: "openai",
					service: "whisper",
					period: null,
					billed: 3,
					equivalent: 0,
				},
			],
			days: [
				{
					provider: "claude",
					service: null,
					period: "2026-10-21",
					billed: 0,
					equivalent: 12.5,
				},
			],
		};
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("totals billed apart from estimates, and opens a provider onto its services", async () => {
		const view = await testing.open();
		await act(async () =>
			fireEvent.click(view.getByRole("tab", { name: /Billing/ })),
		);
		await waitFor(() => view.getByLabelText("range"));
		await waitFor(() => view.getByText("Updated", { exact: false }));
		expect(view.getAllByText("$12.50").length).toBeGreaterThan(0);
		expect(view.queryByText("opus")).toBeNull();
		fireEvent.click(view.getByRole("button", { name: /Claude/ }));
		expect(view.getByText("opus")).toBeTruthy();
		expect(view.getAllByText("estimate").length).toBeGreaterThan(0);
	});
});

describe("App's billing sources", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
		testing.billingView = {
			currency: "USD",
			currencies: ["USD", "EUR"],
			pulledAt: "2026-10-21T12:00:00.000Z",
			providers: [
				{
					provider: "openai",
					state: "missing",
					message: "needs OPENAI_ADMIN_KEY",
					added: 0,
					cred: "OPENAI_ADMIN_KEY",
				},
				{
					provider: "cloudflare",
					state: "unreachable",
					message: "could not reach cloudflare: answered 500",
					added: 0,
					cred: "CLOUDFLARE_API_TOKEN",
				},
			],
		};
		testing.spendReport = {
			updated: "2026-10-21T12:00:00.000Z",
			currency: "EUR",
			rateDate: "2026-10-20",
			rateError: null,
			services: [
				{
					provider: "openai",
					service: "whisper",
					period: null,
					billed: 3,
					equivalent: 0,
				},
			],
			days: [],
		};
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("links a missing cred to the Creds page, shows a failed pull on its row, and the rate date", async () => {
		const view = await testing.open();
		await act(async () =>
			fireEvent.click(view.getByRole("tab", { name: /Billing/ })),
		);
		const link = await waitFor(() =>
			view.getByRole("link", { name: /OPENAI_ADMIN_KEY/ }),
		);
		expect(link.getAttribute("href")).toBe("#creds/OPENAI_ADMIN_KEY");
		expect(view.getByText(/could not reach cloudflare/)).toBeTruthy();
		await waitFor(() => view.getByText(/rate of each day/));
		expect(view.getByText(/2026-10-20/)).toBeTruthy();
		expect(view.getAllByText("€3").length).toBeGreaterThan(0);
	});
});
