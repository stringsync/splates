import { describe, expect, it } from "bun:test";
import { Duration } from "webappwiz/time";
import { FakeWallClock } from "webappwiz/time/testing";
import { MemoryStorage } from "../storage/testing";
import {
	CATALOG,
	catalogKey,
	catalogOf,
	inputKey,
	type Price,
	Prices,
	priced,
} from "./index";

describe("prices", () => {
	it("reads each model's list price and context tiers off models.dev", () => {
		expect(catalogOf(MODELS_DEV)).toEqual({
			"openai/gpt-6.1-sol": {
				input: 2,
				output: 10,
				cacheRead: 0.1,
				cacheWrite: 2.5,
				tiers: [
					{
						input: 4,
						output: 15,
						cacheRead: 0.2,
						cacheWrite: 5,
						context: 272_000,
					},
				],
			},
			"opencode-go/kimi-k3": {
				input: 3,
				output: 15,
				cacheRead: 0.3,
				cacheWrite: 3,
				tiers: [],
			},
		});
	});

	it("prices a turn's tokens, at the dearer tier once its context passed it", () => {
		const price = catalogOf(MODELS_DEV)["openai/gpt-6.1-sol"] as Price;
		const tokens = {
			input: 1_000_000,
			cachedRead: 10_000_000,
			cachedWrite: 0,
			output: 100_000,
		};

		expect(priced(price, { ...tokens, context: 100_000 })).toBeCloseTo(4);
		expect(priced(price, { ...tokens, context: 300_000 })).toBeCloseTo(7.5);
	});

	it("finds Codex's models under OpenAI and OpenCode's by their own provider", () => {
		expect(catalogKey("codex", "gpt-6.1-sol")).toBe("openai/gpt-6.1-sol");
		expect(catalogKey("opencode", "opencode-go/kimi-k3")).toBe(
			"opencode-go/kimi-k3",
		);
		expect(catalogKey("claude", "claude-opus-5-5")).toBeNull();
		expect(catalogKey("codex", null)).toBeNull();
	});

	it("finds Claude's models for their inputs by their roster name", () => {
		expect(inputKey("claude", "opus", "Opus 5.5")).toBe(
			"anthropic/claude-opus-5-5",
		);
		expect(inputKey("claude", "opus", null)).toBeNull();
		expect(inputKey("codex", "gpt-6.1-sol", null)).toBe("openai/gpt-6.1-sol");
	});

	// scry-ignore simple-test-setup: the clock it moves and the network going down are this test's own inputs.
	it("keeps the catalog a day, then fetches it again, standing on the old one offline", async () => {
		const clock = new FakeWallClock(1_000);
		const { prices, asked } = answering(
			[Response.json(MODELS_DEV), new Error("offline")],
			clock,
		);

		const first = await prices.catalog();
		await prices.catalog();
		clock.advance(Duration.days(2));
		const stale = await prices.catalog();

		expect(asked).toEqual([CATALOG, CATALOG]);
		expect(Object.keys(first ?? {})).toHaveLength(2);
		expect(stale).toEqual(first);
	});

	it("has no catalog when it never heard one and cannot fetch it", async () => {
		const { prices } = answering([new Response("down", { status: 503 })]);

		expect(await prices.catalog()).toBeNull();
	});
});

/**
 * Prices fetched from a network giving `answers` in turn, a thrown error for
 * each `Error`, and the URLs it was asked.
 */
function answering(
	answers: (Response | Error)[],
	clock = new FakeWallClock(1_000),
): { prices: Prices; asked: string[] } {
	const asked: string[] = [];
	const fetcher = async (url: string) => {
		asked.push(url);
		const answer = answers.shift();
		if (answer === undefined || answer instanceof Error) {
			throw answer ?? new Error("no answer");
		}
		return answer;
	};
	const prices = new Prices(new MemoryStorage(), {
		clock,
		fetcher: fetcher as unknown as typeof fetch,
	});
	return { prices, asked };
}

const MODELS_DEV = {
	openai: {
		models: {
			"gpt-6.1-sol": {
				cost: {
					input: 2,
					output: 10,
					cache_read: 0.1,
					cache_write: 2.5,
					tiers: [
						{
							input: 4,
							output: 15,
							cache_read: 0.2,
							cache_write: 5,
							tier: { type: "context", size: 272_000 },
						},
					],
				},
			},
			"no-price": { name: "unpriced" },
		},
	},
	"opencode-go": {
		models: {
			"kimi-k3": { cost: { input: 3, output: 15, cache_read: 0.3 } },
		},
	},
};
