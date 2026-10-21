import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { act, cleanup, fireEvent, Testing, waitFor } from "./testing";

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
					message: "api.cloudflare.com answered 500",
					added: 0,
					cred: "CLOUDFLARE_API_TOKEN",
				},
				{
					provider: "typesafe",
					state: "untracked",
					message:
						"splates will price each of its Jev calls from the tokens TypeSafe reports",
					added: 0,
					cred: null,
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
		expect(view.getByText("Pull failed")).toBeTruthy();
		expect(view.getByText("api.cloudflare.com answered 500")).toBeTruthy();
		expect(
			view
				.getByRole("link", { name: /Fix CLOUDFLARE_API_TOKEN/ })
				.getAttribute("href"),
		).toBe("#creds/CLOUDFLARE_API_TOKEN");
		// Said in full, never cut to fit a column.
		expect(view.getByText(/from the tokens TypeSafe reports$/)).toBeTruthy();
		expect(view.getByText("Not tracked yet")).toBeTruthy();
		await waitFor(() => view.getByText(/rate of each day/));
		expect(view.getByText(/2026-10-20/)).toBeTruthy();
		expect(view.getAllByText("€3").length).toBeGreaterThan(0);
	});

	it("pulls again on Retry, and the row shows how it went", async () => {
		const view = await testing.open();
		await act(async () =>
			fireEvent.click(view.getByRole("tab", { name: /Billing/ })),
		);
		const retry = await waitFor(() =>
			view.getByRole("button", { name: "Retry" }),
		);
		testing.billingView = {
			...testing.billingView,
			providers: [
				{
					provider: "cloudflare",
					state: "ok",
					message: "",
					added: 2,
					cred: "CLOUDFLARE_API_TOKEN",
				},
			],
		};
		await act(async () => fireEvent.click(retry));
		await waitFor(() => view.getByText("2 new charges"));
		expect(view.queryByText("Pull failed")).toBeNull();
	});
});
