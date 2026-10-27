import { describe, expect, test } from "bun:test";
import { FakeFs } from "webappwiz/system/testing";
import { MemoryStorage } from "../storage/testing";
import { cloudflare } from "./adapters";
import { pullBilling, readPlans, renewals, Spend, spendReport } from "./index";

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
});
