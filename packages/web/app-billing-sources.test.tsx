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
					dashboard: null,
				},
				{
					provider: "cloudflare",
					state: "unreachable",
					message: "api.cloudflare.com answered 500",
					added: 0,
					cred: "CLOUDFLARE_API_TOKEN",
					dashboard: null,
				},
				{
					provider: "typesafe",
					state: "counted",
					message:
						"Priced from the tokens each of splates's own Jev calls uses; other apps on the same key are not counted",
					added: 0,
					cred: null,
					dashboard: null,
				},
				{
					provider: "fly",
					state: "estimated",
					message:
						"Fly.io has no API for its bill, so runners are estimated from its list prices",
					added: 0,
					cred: null,
					dashboard: "https://fly.io/dashboard",
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
					expected: 0,
				},
			],
			days: [],
			projects: [],
			upcoming: [],
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
		expect(view.getByText("Counted as used")).toBeTruthy();
		expect(
			view.getByText(/other apps on the same key are not counted$/),
		).toBeTruthy();
		expect(view.queryByText("Estimated")).toBeNull();
		expect(
			view.queryByRole("link", { name: "Open Fly.io's billing" }),
		).toBeNull();
		expect(view.queryByText("Runners")).toBeNull();
		expect(view.queryByRole("region", { name: "worker budget" })).toBeNull();
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
					dashboard: null,
				},
			],
		};
		await act(async () => fireEvent.click(retry));
		await waitFor(() => view.getByText("2 new charges"));
		expect(view.queryByText("Pull failed")).toBeNull();
	});
});
