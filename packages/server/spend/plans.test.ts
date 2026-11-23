import { describe, expect, test } from "bun:test";
import { FakeFs } from "core/system/testing";
import { MemoryStorage } from "../storage/testing";
import { cloudflare } from "./adapters";
import {
	BillingRoutes,
	type BillingView,
	mergePlans,
	planViews,
	pullBilling,
	readPlans,
	renewals,
	Spend,
	type SpendReport,
	spendReport,
} from "./index";

const jwt = (claims: object) =>
	`x.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.y`;

const max = {
	provider: "claude",
	service: "Max 20x plan",
	amount: 200,
	currency: "USD",
	everyMonths: 1,
	since: "2025-05-31T19:08:09Z",
};

describe("plans", () => {
	test("reads the plans Claude's and Codex's logins name, at list price", async () => {
		const fs = new FakeFs();
		await fs.write(
			"/home/.claude.json",
			JSON.stringify({
				oauthAccount: {
					organizationRateLimitTier: "default_claude_max_20x",
					subscriptionCreatedAt: "2025-05-18T19:08:09Z",
				},
			}),
		);
		await fs.write(
			"/home/.codex/auth.json",
			JSON.stringify({
				tokens: {
					id_token: jwt({
						"https://api.openai.com/auth": {
							chatgpt_plan_type: "prolite",
							chatgpt_subscription_active_start: "2026-08-31T00:26:14+00:00",
						},
					}),
				},
			}),
		);
		expect(await readPlans(fs, "/home")).toEqual([
			{ ...max, since: "2025-05-18T19:08:09Z" },
			{
				provider: "codex",
				service: "Pro Lite plan",
				amount: 100,
				currency: "USD",
				everyMonths: 1,
				since: "2026-08-31T00:26:14+00:00",
			},
		]);
		expect(await readPlans(new FakeFs(), "/home")).toEqual([]);
	});

	test("reads the CLI profile's plan at its monthly list price", async () => {
		const fs = new FakeFs();
		await fs.mkdir("/kimi/credentials", { recursive: true });
		await fs.write(
			"/kimi/credentials/kimi-code.json",
			JSON.stringify({
				access_token: jwt({}),
				expires_at: Date.parse("2026-10-27T13:00:00Z") / 1000,
			}),
		);
		const asked: string[] = [];
		const fetcher = (async (url: string) => {
			asked.push(url);
			return Response.json(
				url.endsWith("/me")
					? { user_level_name: "Pro" }
					: {
							usages: {
								limit_month_total: { reset_time: "2026-11-28T00:00:00Z" },
							},
						},
			);
		}) as unknown as typeof fetch;

		expect(
			await readPlans(fs, "/home", {
				kimi: {
					home: "/kimi",
					baseUrl: "https://api.kimi.ai/coding/v1",
					now: () => Date.parse("2026-10-27T12:00:00Z"),
					fetcher,
				},
			}),
		).toEqual([
			{
				provider: "kimi",
				service: "Pro plan",
				amount: 39,
				currency: "USD",
				everyMonths: 1,
				since: "2026-11-28T00:00:00.000Z",
			},
		]);
		expect(asked).toEqual([
			"https://api.kimi.ai/coding/v1/me",
			"https://api.kimi.ai/coding/v1/usages",
		]);
	});

	test("prices the CLI profile's plan in USD on api.kimi.com", async () => {
		const fs = new FakeFs();
		await fs.mkdir("/kimi/credentials", { recursive: true });
		await fs.write(
			"/kimi/credentials/kimi-code.json",
			JSON.stringify({
				access_token: jwt({}),
				expires_at: Date.parse("2026-10-27T13:00:00Z") / 1000,
			}),
		);
		const asked: string[] = [];
		const fetcher = (async (url: string) => {
			asked.push(url);
			return Response.json(
				url.endsWith("/me")
					? { user_level_name: "Pro" }
					: {
							usages: {
								limit_month_total: { reset_time: "2026-11-28T00:00:00Z" },
							},
						},
			);
		}) as unknown as typeof fetch;

		expect(
			await readPlans(fs, "/home", {
				kimi: {
					home: "/kimi",
					baseUrl: "https://api.kimi.com/coding/v1",
					now: () => Date.parse("2026-10-27T12:00:00Z"),
					fetcher,
				},
			}),
		).toEqual([
			{
				provider: "kimi",
				service: "Pro plan",
				amount: 39,
				currency: "USD",
				everyMonths: 1,
				since: "2026-11-28T00:00:00.000Z",
			},
		]);
		expect(asked).toEqual([
			"https://api.kimi.com/coding/v1/me",
			"https://api.kimi.com/coding/v1/usages",
		]);
	});

	test("renews at the plan's own interval", () => {
		const annual = { ...max, everyMonths: 12, since: "2026-01-31T00:00:00Z" };
		expect(
			renewals([annual], "2026-11-01", "2028-02-01").map((each) => each.day),
		).toEqual(["2027-01-31", "2028-01-31"]);
	});

	test("a plan renews each month on the day it began, or the month's last", () => {
		expect(
			renewals([max], "2026-01-15", "2026-04-01").map((each) => each.day),
		).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
		expect(renewals([max], "2025-04-01", "2025-06-01")).toEqual([
			{
				provider: "claude",
				service: "Max 20x plan",
				day: "2025-05-31",
				amount: 200,
				currency: "USD",
			},
		]);
	});

	test("a report puts expected charges on the bill, and what is due later this month as upcoming", async () => {
		const spend = new Spend(new MemoryStorage());
		const report = await spendReport(spend, {
			since: "2026-10-01T00:00:00.000Z",
			until: "2026-10-28T00:00:00.000Z",
			now: "2026-10-27T12:00:00.000Z",
			expected: [
				{
					provider: "claude",
					service: "Max 20x plan",
					day: "2026-10-18",
					amount: 200,
					currency: "USD",
				},
				{
					provider: "cloudflare",
					service: "Workers Paid",
					day: "2026-10-30",
					amount: 5,
					currency: "USD",
				},
				{
					provider: "claude",
					service: "Max 20x plan",
					day: "2026-11-18",
					amount: 200,
					currency: "USD",
				},
			],
		});
		expect(report.services.map((row) => [row.service, row.expected])).toEqual([
			["Max 20x plan", 200],
		]);
		expect(report.upcoming.map((row) => [row.service, row.expected])).toEqual([
			["Workers Paid", 5],
		]);
	});
	test("each paid Cloudflare subscription is expected at its period's end, once it has not passed", async () => {
		const answers: Record<string, object> = {
			"/client/v4/user/billing/history": { result: [] },
			"/client/v4/accounts": { result: [{ id: "a" }] },
			"/client/v4/accounts/a/subscriptions": {
				result: [
					{
						price: 5,
						currency: "USD",
						current_period_end: "2026-10-30T00:00:00Z",
						rate_plan: { public_name: "Workers Paid" },
					},
					{
						price: 0,
						currency: "USD",
						current_period_end: "2026-10-30T00:00:00Z",
						rate_plan: { public_name: "Teams Free" },
					},
					{
						price: 20,
						currency: "USD",
						current_period_end: "2026-10-01T00:00:00Z",
						rate_plan: { public_name: "Pro" },
					},
				],
			},
		};
		const statuses = await pullBilling(new Spend(new MemoryStorage()), {
			cred: async () => "k",
			today: "2026-10-27",
			providers: [cloudflare],
			fetcher: (async (url: string) =>
				Response.json(
					answers[new URL(url).pathname],
				)) as unknown as typeof fetch,
		});
		expect(statuses[0]?.expected).toEqual([
			{
				provider: "cloudflare",
				service: "Workers Paid",
				day: "2026-10-30",
				amount: 5,
				currency: "USD",
			},
		]);
	});

	test("merges detected plans with manual overrides and builds views for all agent providers", () => {
		const detected = [max];
		const overrides = {
			antigravity: { amount: 20, renewalDay: 1, currency: "USD" },
		};
		const merged = mergePlans(detected, overrides);
		expect(merged.map((each) => [each.provider, each.amount])).toEqual([
			["claude", 200],
			["antigravity", 20],
		]);
		expect(planViews(detected, overrides)).toEqual([
			{
				provider: "claude",
				source: "detected",
				service: "Max 20x plan",
				amount: 200,
				currency: "USD",
				renewalDay: 31,
				hasDetected: true,
			},
			{
				provider: "codex",
				source: "none",
				service: null,
				amount: null,
				currency: null,
				renewalDay: null,
				hasDetected: false,
			},
			{
				provider: "kimi",
				source: "none",
				service: null,
				amount: null,
				currency: null,
				renewalDay: null,
				hasDetected: false,
			},
			{
				provider: "antigravity",
				source: "manual",
				service: "Monthly plan",
				amount: 20,
				currency: "USD",
				renewalDay: 1,
				hasDetected: false,
			},
		]);

		const overriddenClaude = planViews(detected, {
			claude: { amount: 100, renewalDay: 15, currency: "USD" },
		});
		expect(overriddenClaude[0]).toEqual({
			provider: "claude",
			source: "manual",
			service: "Monthly plan",
			amount: 100,
			currency: "USD",
			renewalDay: 15,
			hasDetected: true,
		});
	});

	test("saves, clears, and factors per-provider plan overrides into spend reports", async () => {
		const storage = new MemoryStorage();
		const ledger = new Spend(storage);
		const routes = new BillingRoutes(storage, ledger, async () => undefined, {
			plans: async () => [{ ...max, since: "2026-01-18T00:00:00.000Z" }],
		});

		const put = await routes.setPlan(
			new Request("http://local/api/billing/plan", {
				method: "PUT",
				body: JSON.stringify({
					provider: "antigravity",
					amount: 20,
					renewalDay: 1,
				}),
			}),
		);
		const view = (await put.json()) as BillingView;
		expect(view.plans?.find((each) => each.provider === "antigravity")).toEqual(
			{
				provider: "antigravity",
				source: "manual",
				service: "Monthly plan",
				amount: 20,
				currency: "USD",
				renewalDay: 1,
				hasDetected: false,
			},
		);

		// Changing currency keeps saved plans intact.
		await routes.setCurrency(
			new Request("http://local/api/billing/currency", {
				method: "PUT",
				body: JSON.stringify({ currency: "USD" }),
			}),
		);

		const report = (await (
			await routes.spend(
				new Request(
					"http://local/api/spend?since=2026-10-01T00:00:00.000Z&until=2026-10-20T00:00:00.000Z",
				),
			)
		).json()) as SpendReport;
		expect(
			report.services.map((each) => [
				each.provider,
				each.service,
				each.expected,
			]),
		).toEqual([
			["antigravity", "Monthly plan", 20],
			["claude", "Max 20x plan", 200],
		]);

		const cleared = (await (
			await routes.clearPlan(
				new Request("http://local/api/billing/plan?provider=antigravity", {
					method: "DELETE",
				}),
			)
		).json()) as BillingView;
		expect(
			cleared.plans?.find((each) => each.provider === "antigravity")?.source,
		).toBe("none");
	});
});
