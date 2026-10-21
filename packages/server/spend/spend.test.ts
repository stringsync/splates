import { expect, test } from "bun:test";
import { MemoryStorage } from "../storage/testing";
import { Spend } from "./index";
import { turnSpend } from "./turn";

const entry = (over: Partial<Parameters<Spend["record"]>[0]> = {}) => ({
	at: "2026-10-21T10:00:00.000Z",
	provider: "claude",
	service: "opus",
	kind: "equivalent" as const,
	dollars: 1,
	project: null,
	task: null,
	conversation: null,
	...over,
});

test("totals split kinds, and by provider, service and period", async () => {
	const spend = new Spend(new MemoryStorage());
	await spend.record(
		entry(),
		entry({ dollars: 2, at: "2026-10-22T10:00:00.000Z" }),
		entry({ provider: "opencode", service: "m", kind: "billed", dollars: 4 }),
		entry({ dollars: 0 }),
	);
	expect(await spend.totals()).toEqual([
		{ provider: null, service: null, period: null, billed: 4, equivalent: 3 },
	]);
	expect(await spend.totals({ by: "provider" })).toEqual([
		{
			provider: "claude",
			service: null,
			period: null,
			billed: 0,
			equivalent: 3,
		},
		{
			provider: "opencode",
			service: null,
			period: null,
			billed: 4,
			equivalent: 0,
		},
	]);
	const weekly = await spend.totals({ per: "week", by: "service" });
	expect(weekly.map((row) => row.period)).toEqual(["2026-10-19", "2026-10-19"]);
	expect(await spend.totals({ per: "month", provider: "claude" })).toEqual([
		{
			provider: null,
			service: null,
			period: "2026-10-01",
			billed: 0,
			equivalent: 3,
		},
	]);
});

const used = (over: Partial<Parameters<typeof turnSpend>[2]>) => ({
	input: 0,
	cached: 0,
	output: 0,
	cost: null,
	context: null,
	...over,
});

test("a turn is the agent's said cost, else its tokens at list price", () => {
	expect(
		turnSpend("claude", null, used({ cost: 1 }), used({ cost: 1.5 }), null),
	).toEqual({ dollars: 0.5, kind: "equivalent" });
	expect(
		turnSpend("claude", null, used({ cost: 3 }), used({ cost: 0.25 }), null),
	).toBeNull();
	const catalog = {
		"openai/gpt": {
			input: 1,
			output: 10,
			cacheRead: 0.1,
			cacheWrite: 1,
			tiers: [],
		},
	};
	const spent = turnSpend(
		"codex",
		"gpt",
		used({}),
		used({ input: 2_000_000, cached: 1_000_000, output: 100_000 }),
		catalog,
	);
	expect(spent?.kind).toBe("equivalent");
	expect(spent?.dollars).toBeCloseTo(1 + 0.1 + 1);
	expect(
		turnSpend("codex", "nope", used({}), used({ input: 5 }), catalog),
	).toBeNull();
});

test("pulling billing converts, dedupes, and reports what it cannot reach", async () => {
	const { pullBilling } = await import("./index");
	const spend = new Spend(new MemoryStorage());
	const fetcher = (async (url: string) => {
		if (url.includes("openai.com")) {
			return Response.json({
				data: [
					{
						start_time: Date.parse("2026-10-19T00:00:00Z") / 1000,
						results: [
							{ amount: { value: 2, currency: "eur" }, line_item: "whisper" },
						],
					},
				],
			});
		}
		if (url.includes("frankfurter")) {
			return Response.json({ date: "2026-10-19", rates: { USD: 1.1 } });
		}
		return new Response("no", { status: 500 });
	}) as unknown as typeof fetch;
	const options = {
		cred: async (name: string) =>
			name === "OPENAI_ADMIN_KEY" || name === "CLOUDFLARE_API_TOKEN"
				? "k"
				: undefined,
		fetcher,
		today: "2026-10-21",
	};
	const statuses = await pullBilling(spend, options);
	expect(statuses.map((each) => [each.provider, each.state])).toEqual([
		["openai", "ok"],
		["cloudflare", "unreachable"],
		["digitalocean", "missing"],
		["hetzner", "manual"],
		["aws", "manual"],
		["typesafe", "manual"],
	]);
	await pullBilling(spend, options);
	const [row] = await spend.totals({ by: "service", provider: "openai" });
	expect(row?.billed).toBeCloseTo(2.2);
	expect((await spend.entries())[0]?.original?.currency).toBe("EUR");
});

test("a report totals the range by service and by provider's day", async () => {
	const { spendReport } = await import("./report");
	const spend = new Spend(new MemoryStorage());
	await spend.record(
		entry(),
		entry({ at: "2026-10-22T10:00:00.000Z", dollars: 2 }),
		entry({ at: "2026-09-01T10:00:00.000Z", dollars: 8 }),
	);
	const report = await spendReport(spend, {
		since: "2026-10-01T00:00:00.000Z",
		now: "2026-10-22T12:00:00.000Z",
	});
	expect(report.updated).toBe("2026-10-22T12:00:00.000Z");
	expect(report.services.map((row) => [row.service, row.equivalent])).toEqual([
		["opus", 3],
	]);
	expect(report.days.map((row) => [row.period, row.equivalent])).toEqual([
		["2026-10-21", 1],
		["2026-10-22", 2],
	]);
});

test("a report converts to the display currency at each day's rate, and says when it cannot", async () => {
	const { spendReport } = await import("./report");
	const { Rates } = await import("./rates");
	const spend = new Spend(new MemoryStorage());
	await spend.record(
		entry({
			kind: "billed",
			dollars: 2.2,
			original: {
				amount: 2,
				currency: "EUR",
				rate: 1.1,
				rateDate: "2026-10-21",
			},
		}),
		entry({ dollars: 1.1 }),
	);
	const fetcher = (async (url: string) =>
		url.includes("from=USD")
			? Response.json({ date: "2026-10-20", rates: { EUR: 0.9 } })
			: new Response("no", { status: 500 })) as unknown as typeof fetch;
	const report = await spendReport(spend, {
		now: "2026-10-22T12:00:00.000Z",
		rates: new Rates("EUR", fetcher),
	});
	expect(report.currency).toBe("EUR");
	expect(report.rateDate).toBe("2026-10-20");
	expect(report.services[0]?.billed).toBeCloseTo(2);
	expect(report.services[0]?.equivalent).toBeCloseTo(0.99);
	const down = await spendReport(spend, {
		now: "2026-10-22T12:00:00.000Z",
		rates: new Rates(
			"EUR",
			(async () =>
				new Response("no", { status: 500 })) as unknown as typeof fetch,
		),
	});
	expect(down.currency).toBe("USD");
	expect(down.rateError).not.toBeNull();
});
