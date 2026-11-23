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

	it("shows agent plans in Billing sources and saves and clears a manual Antigravity plan", async () => {
		const claudePlan = {
			provider: "claude" as const,
			source: "detected" as const,
			service: "Max 5x plan",
			amount: 100,
			currency: "USD",
			renewalDay: 18,
			hasDetected: true,
		};
		testing.billingView = {
			...testing.billingView,
			currency: "USD",
			plans: [
				claudePlan,
				{
					provider: "antigravity",
					source: "none",
					service: null,
					amount: null,
					currency: null,
					renewalDay: null,
					hasDetected: false,
				},
			],
		};
		const view = await testing.open();
		await act(async () =>
			fireEvent.click(view.getByRole("tab", { name: /Billing/ })),
		);
		await waitFor(() => view.getByText("Plan detected"));
		expect(
			view.getByText(/Max 5x plan · \$100\/mo · renews on day 18/),
		).toBeTruthy();
		expect(view.getByText("Plan not detected")).toBeTruthy();

		fireEvent.click(view.getByRole("button", { name: "Set Antigravity plan" }));
		fireEvent.change(view.getByLabelText("Antigravity monthly price"), {
			target: { value: "20" },
		});
		fireEvent.change(view.getByLabelText("Antigravity renewal day"), {
			target: { value: "5" },
		});
		testing.billingView = {
			...testing.billingView,
			plans: [
				claudePlan,
				{
					provider: "antigravity",
					source: "manual",
					service: "Monthly plan",
					amount: 20,
					currency: "USD",
					renewalDay: 5,
					hasDetected: false,
				},
			],
		};
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Save" })),
		);
		await waitFor(() => view.getByText("Plan set"));
		expect(view.getByText(/\$20\/mo · renews on day 5/)).toBeTruthy();
		expect(testing.posts.at(-1)).toMatchObject({
			path: "/api/billing/plan",
			method: "PUT",
			body: JSON.stringify({
				provider: "antigravity",
				amount: 20,
				renewalDay: 5,
			}),
		});

		fireEvent.click(
			view.getByRole("button", { name: "Edit Antigravity plan" }),
		);
		testing.billingView = {
			...testing.billingView,
			plans: [
				claudePlan,
				{
					provider: "antigravity",
					source: "none",
					service: null,
					amount: null,
					currency: null,
					renewalDay: null,
					hasDetected: false,
				},
			],
		};
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Clear" })),
		);
		await waitFor(() => view.getByText("Plan not detected"));
		expect(testing.posts.at(-1)).toMatchObject({
			path: "/api/billing/plan?provider=antigravity",
			method: "DELETE",
		});
	});
});
