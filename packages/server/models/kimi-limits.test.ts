import { describe, expect, it } from "bun:test";
import { FakeFs } from "webappwiz/system/testing";
import { KIMI_ARGV } from "./kimi";
import { isKimi, kimiLimits, limitsIn } from "./kimi-limits";

describe("kimiLimits", () => {
	it("knows the roster's Kimi and a kimi of the person's own", () => {
		const agent = (argv: string[]) => ({ id: "x", name: "x", argv });
		expect(isKimi(agent(KIMI_ARGV))).toBe(true);
		expect(isKimi(agent(["/opt/bin/kimi", "acp"]))).toBe(true);
		expect(isKimi(agent(["codex-acp"]))).toBe(false);
	});
	it("takes the 5-hour, weekly and monthly windows, leaving Code's share of the month", () => {
		expect(limitsIn(USAGES, AT)).toEqual([
			{
				window: "five_hour",
				used: 0.5,
				resets: "2026-10-27T14:00:00.000Z",
				at: AT,
			},
			{
				window: "seven_day",
				used: 0.25,
				resets: "2026-11-01T00:00:00.000Z",
				at: AT,
			},
			{
				window: "month",
				used: 0.1,
				resets: "2026-11-15T00:00:00.000Z",
				at: AT,
			},
		]);
	});

	it("leaves out a window with no reset or ratio, and says nothing of an odd answer", () => {
		expect(
			limitsIn({ usages: { limit_5h: { used_ratio: 0.5 }, limit_7d: {} } }, AT),
		).toEqual([]);
		expect(limitsIn("nope", AT)).toEqual([]);
	});
	it("asks the configured base with Kimi's own sign-in", async () => {
		const fs = await signedIn(NOW + 60_000);
		await fs.write(
			`${HOME}/config.toml`,
			'[providers."managed:kimi-code"]\nbase_url = "https://api.kimi.ai/coding/v1/"\n',
		);
		const asked: { url: string; auth: string | null }[] = [];
		const fetcher = (async (url: string, init?: RequestInit) => {
			asked.push({
				url,
				auth: new Headers(init?.headers).get("Authorization"),
			});
			return Response.json(USAGES);
		}) as unknown as typeof fetch;
		const limits = await kimiLimits({
			fs,
			now: () => NOW,
			home: HOME,
			fetcher,
		});
		expect(asked).toEqual([
			{ url: "https://api.kimi.ai/coding/v1/usages", auth: "Bearer tok" },
		]);
		expect(limits.map((each) => each.window)).toEqual([
			"five_hour",
			"seven_day",
			"month",
		]);
	});

	it("asks nothing once Kimi's sign-in has expired, or when it is signed out", async () => {
		let asked = 0;
		const fetcher = (async () => {
			asked++;
			return Response.json(USAGES);
		}) as unknown as typeof fetch;
		const expired = await signedIn(NOW - 1);
		expect(
			await kimiLimits({ fs: expired, now: () => NOW, home: HOME, fetcher }),
		).toEqual([]);
		expect(
			await kimiLimits({
				fs: new FakeFs(),
				now: () => NOW,
				home: HOME,
				fetcher,
			}),
		).toEqual([]);
		expect(asked).toBe(0);
	});

	it("says none when the endpoint refuses or cannot be reached", async () => {
		const fs = await signedIn(NOW + 60_000);
		const refused = (async () =>
			new Response("no", { status: 401 })) as unknown as typeof fetch;
		const down = (async () => {
			throw new Error("offline");
		}) as unknown as typeof fetch;
		const ask = (fetcher: typeof fetch) =>
			kimiLimits({
				fs,
				now: () => NOW,
				home: HOME,
				baseUrl: "http://localhost:1",
				fetcher,
			});
		expect(await ask(refused)).toEqual([]);
		expect(await ask(down)).toEqual([]);
	});
});

const NOW = Date.parse("2026-10-27T12:00:00Z");
const AT = new Date(NOW).toISOString();
const HOME = "/home/me/.kimi-code";

/** What Kimi's `/usages` says of a plan half through its 5 hours. */
const USAGES = {
	usages: {
		limit_5h: { used_ratio: 0.5, reset_time: "2026-10-27T14:00:00Z" },
		limit_7d: { used_ratio: "0.25", reset_time: "2026-11-01T00:00:00Z" },
		limit_month_total: { used_ratio: 0.1, reset_time: "2026-11-15T00:00:00Z" },
		limit_month_code: { used_ratio: 0.05, reset_time: "2026-11-15T00:00:00Z" },
	},
	boosterWallet: null,
};

async function signedIn(expires: number): Promise<FakeFs> {
	const fs = new FakeFs();
	await fs.mkdir(`${HOME}/credentials`, { recursive: true });
	await fs.write(
		`${HOME}/credentials/kimi-code.json`,
		JSON.stringify({ access_token: "tok", expires_at: expires / 1000 }),
	);
	return fs;
}
