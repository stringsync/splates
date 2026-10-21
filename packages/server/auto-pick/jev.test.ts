import { describe, expect, it } from "bun:test";
import { Spend } from "../spend";
import { MemoryStorage } from "../storage/testing";
import { Jev } from "./jev";
import { serve } from "./testing";

const JUDGMENT = {
	state: { prompt: "hi" },
	questions: { lookup: { type: "noul" as const, instructions: "Is it?" } },
};

describe("Jev", () => {
	it("posts the judgment with its model and reads the answers", async () => {
		const server = serve({ answers: { lookup: 0.8 } });
		const verdict = await new Jev("key", { fetch: server.fetch }).judge(
			JUDGMENT,
		);
		expect(verdict.answers.get("lookup")).toBe(0.8);
		const [request] = server.requests;
		expect(request?.url).toBe("https://api.typesafe.ai/v1/systemone");
		expect(new Headers(request?.init.headers).get("authorization")).toBe(
			"Bearer key",
		);
		expect(JSON.parse(String(request?.init.body))).toEqual({
			model: "jev-latest",
			...JUDGMENT,
		});
	});

	it("records each call's input tokens at Jev's price, output free, and says the price", async () => {
		const spend = new Spend(new MemoryStorage());
		const server = serve({
			answers: { lookup: 0.8 },
			usage: { input_tokens: 2_000_000, output_tokens: 500 },
		});
		const verdict = await new Jev("key", {
			fetch: server.fetch,
			spend,
			now: () => new Date("2026-10-21T10:00:00.000Z"),
		}).judge(JUDGMENT);
		expect(verdict.usage).toEqual({ input: 2_000_000, output: 500 });
		expect(verdict.dollars).toBeCloseTo(0.084);
		const [entry, ...rest] = await spend.entries();
		expect(rest).toEqual([]);
		expect(entry).toEqual({
			at: "2026-10-21T10:00:00.000Z",
			provider: "typesafe",
			service: "jev-latest",
			kind: "billed",
			dollars: expect.closeTo(0.084),
			project: null,
			task: null,
			conversation: null,
		});
	});

	it("records whom each call was for", async () => {
		const spend = new Spend(new MemoryStorage());
		const server = serve({
			answers: { lookup: 0.8 },
			usage: { input_tokens: 1000, output_tokens: 5 },
		});
		await new Jev("key", {
			fetch: server.fetch,
			spend,
			attribution: { project: "splates", task: "#812", conversation: "c1" },
		}).judge(JUDGMENT);
		expect(await spend.entries()).toMatchObject([
			{ project: "splates", task: "#812", conversation: "c1" },
		]);
	});

	it("names a call made for something beyond Auto pick after its model, for Billing to show apart", async () => {
		const spend = new Spend(new MemoryStorage());
		const server = serve({
			answers: { lookup: 0.8 },
			usage: { input_tokens: 1000, output_tokens: 5 },
		});
		await new Jev("key", {
			fetch: server.fetch,
			spend,
			attribution: {
				project: "splates",
				task: null,
				conversation: "c1",
				purpose: "notes",
			},
		}).judge(JUDGMENT);
		expect(await spend.entries()).toMatchObject([
			{ service: "jev-latest notes" },
		]);
	});

	it("records nothing for a reply that says no usage", async () => {
		const spend = new Spend(new MemoryStorage());
		const server = serve({ answers: { lookup: 0.8 } });
		const verdict = await new Jev("key", { fetch: server.fetch, spend }).judge(
			JUDGMENT,
		);
		expect(await spend.entries()).toEqual([]);
		expect(verdict.dollars).toBeUndefined();
	});

	it("says what went wrong without the URL", async () => {
		const server = serve({ error: "no" }, 401);
		await expect(
			new Jev("key", { fetch: server.fetch }).judge(JUDGMENT),
		).rejects.toThrow("Jev answered 401");
	});
});
