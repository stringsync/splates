import { beforeEach, describe, expect, test } from "bun:test";
import { MemoryStorage } from "../storage/testing";
import { PROVIDERS, pullBilling, Spend } from "./index";
import { Rates } from "./rates";
import { spendReport } from "./report";
import { BillingRoutes } from "./routes";
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

describe("spend", () => {
	let storage: MemoryStorage;
	let spend: Spend;

	beforeEach(() => {
		storage = new MemoryStorage();
		spend = new Spend(storage);
	});

	test("totals split kinds, and by provider, service and period", async () => {
		await spend.record(
			entry(),
			entry({ dollars: 2, at: "2026-10-22T10:00:00.000Z" }),
			entry({ provider: "opencode", service: "m", kind: "billed", dollars: 4 }),
			entry({ dollars: 0 }),
		);
		expect(await spend.totals()).toEqual([
			{
				provider: null,
				service: null,
				period: null,
				billed: 4,
				equivalent: 3,
				expected: 0,
			},
		]);
		expect(await spend.totals({ by: "provider" })).toEqual([
			{
				provider: "claude",
				service: null,
				period: null,
				billed: 0,
				equivalent: 3,
				expected: 0,
			},
			{
				provider: "opencode",
				service: null,
				period: null,
				billed: 4,
				equivalent: 0,
				expected: 0,
			},
		]);
		const weekly = await spend.totals({ per: "week", by: "service" });
		expect(weekly.map((row) => row.period)).toEqual([
			"2026-10-19",
			"2026-10-19",
		]);
		expect(await spend.totals({ per: "month", provider: "claude" })).toEqual([
			{
				provider: null,
				service: null,
				period: "2026-10-01",
				billed: 0,
				equivalent: 3,
				expected: 0,
			},
		]);
	});

	test("historical runner rows stay stored and do not count as spend", async () => {
		const log = storage.log<unknown>("spend.jsonl");
		await log.append(
			{ row: "runner", id: "old-runner", dollarsPerHour: 1 },
			{ row: "job", id: "old-job", runner: "old-runner" },
		);
		await spend.record(entry());
		expect(await spend.entries()).toEqual([entry()]);
		expect(await spend.totals()).toEqual([
			{
				provider: null,
				service: null,
				period: null,
				billed: 0,
				equivalent: 1,
				expected: 0,
			},
		]);
		expect(await log.replay()).toHaveLength(3);
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

	test("converts, dedupes, and reports what it cannot reach when pulling billing", async () => {
		const options = billingOptions();
		const statuses = await pullBilling(spend, options);
		expect(statuses.map((each) => [each.provider, each.state])).toEqual([
			["openai", "ok"],
			["cloudflare", "unreachable"],
			["typesafe", "counted"],
		]);
		expect(statuses[1]?.message).toBe("api.cloudflare.com answered 500");
		await pullBilling(spend, options);
		const [row] = await spend.totals({ by: "service", provider: "openai" });
		expect(row?.billed).toBeCloseTo(2.2);
		expect((await spend.entries())[0]?.original?.currency).toBe("EUR");
	});

	test("a report totals the range by service and by provider's day", async () => {
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
		expect(report.services.map((row) => [row.service, row.equivalent])).toEqual(
			[["opus", 3]],
		);
		expect(report.days.map((row) => [row.period, row.equivalent])).toEqual([
			["2026-10-21", 1],
			["2026-10-22", 2],
		]);
	});

	test("converts a report to the display currency at each day's rate, and says when it cannot", async () => {
		await spend.record(...euroDay());
		const fetcher = eurRates();
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

	test("pages through Cloudflare's billing history until a short page, and notes it lags", async () => {
		const item = (num: number) => ({
			id: `b${num}`,
			amount: 1,
			currency: "USD",
			occurred_at: "2026-10-19T00:00:00Z",
			description: "Workers",
		});
		const pages = [
			Array.from({ length: 100 }, (_, num) => item(num)),
			[item(100), item(101)],
		];
		const asked: string[] = [];
		const fetcher = (async (url: string) => {
			asked.push(url);
			const page = Number(new URL(url).searchParams.get("page"));
			return Response.json({ result: pages[page - 1] ?? [] });
		}) as unknown as typeof fetch;
		const statuses = await pullBilling(spend, {
			...billingOptions(),
			fetcher,
			providers: PROVIDERS.filter((each) => each.id === "cloudflare"),
		});
		expect(asked.filter((url) => url.includes("billing/history")).length).toBe(
			2,
		);
		expect(statuses[0]?.added).toBe(102);
		expect(statuses[0]?.message).toContain("in arrears");
	});

	test("before any pull, the sources show TypeSafe counted", async () => {
		const routes = new BillingRoutes(storage, spend, async () => undefined);
		const view = (await (await routes.read()).json()) as {
			providers: { provider: string; state: string }[];
		};
		expect(view.providers.map((each) => [each.provider, each.state])).toEqual([
			["openai", "ok"],
			["cloudflare", "ok"],
			["typesafe", "counted"],
		]);
	});
});

/** A fetch that answers OpenAI's costs and the exchange rate; any other host, Cloudflare among them, answers 500. */
function billingFetch(): typeof fetch {
	const answers: [string, unknown][] = [
		[
			"openai.com",
			{
				data: [
					{
						start_time: Date.parse("2026-10-19T00:00:00Z") / 1000,
						results: [
							{ amount: { value: 2, currency: "eur" }, line_item: "whisper" },
						],
					},
				],
			},
		],
		["frankfurter", { date: "2026-10-19", rates: { USD: 1.1 } }],
	];
	return (async (url: string) => {
		const answer = answers.find(([host]) => url.includes(host));
		return answer === undefined
			? new Response("no", { status: 500 })
			: Response.json(answer[1]);
	}) as unknown as typeof fetch;
}

/** A fetch that answers USD to EUR rates and fails any other. */
function eurRates(): typeof fetch {
	return (async (url: string) =>
		url.includes("from=USD")
			? Response.json({ date: "2026-10-20", rates: { EUR: 0.9 } })
			: new Response("no", { status: 500 })) as unknown as typeof fetch;
}

/** What pulling billing is given: keys for OpenAI and Cloudflare, the fetch above, and the day. */
function billingOptions() {
	return {
		cred: async (name: string) =>
			name === "OPENAI_ADMIN_KEY" || name === "CLOUDFLARE_API_TOKEN"
				? "k"
				: undefined,
		fetcher: billingFetch(),
		today: "2026-10-21",
	};
}

/** A day billed in euros beside one at list price. */
function euroDay() {
	return [
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
	];
}
