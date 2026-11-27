import { describe, expect, it } from "bun:test";
import { FakeFs } from "core/system/testing";
import { FsStorage } from "../storage";
import { Health, providerFault } from "./health";

describe("Health", () => {
	it("reads a provider fault as a 5xx or overloaded, not a spent plan or a port a 5xx or an overloaded provider, not a spent plan", () => {
		expect(providerFault("API Error: 529 overloaded_error")).toEqual({
			status: 529,
		});
		expect(providerFault("HTTP 503 Service Unavailable")).toEqual({
			status: 503,
		});
		expect(providerFault("Service unavailable")).toEqual({ status: null });
		expect(providerFault("usage limit reached, error 503")).toBeNull();
		expect(providerFault("tests failed on port 5000")).toBeNull();
	});

	it("avoids a model once it fails three times in half an hour, until half an hour after the last", async () => {
		const each = health();
		await fail(each, 20);
		await fail(each, 10);
		expect(await each.avoided(NOW)).toEqual([]);
		await fail(each, 5);
		const [avoided] = await each.avoided(NOW);
		expect(avoided).toMatchObject({
			agent: "claude",
			model: "opus",
			errors: 3,
			until: "2026-11-19T14:25:00.000Z",
		});
	});

	it("forgets errors older than half an hour", async () => {
		const each = health();
		await fail(each, 50);
		await fail(each, 45);
		await fail(each, 40);
		expect(await each.avoided(NOW)).toEqual([]);
	});

	it("avoids a model on one error while its status page names an incident", async () => {
		const each = health("Elevated errors");
		await fail(each, 2);
		expect(await each.avoided(NOW)).toMatchObject([
			{ errors: 1, incident: "Elevated errors" },
		]);
	});

	it("tries a model at once when cleared, and again after new errors", async () => {
		const each = health();
		await fail(each, 9);
		await fail(each, 8);
		await fail(each, 7);
		await each.clear("claude", "opus", new Date(NOW.getTime() - 60_000));
		expect(await each.avoided(NOW)).toEqual([]);
	});
});

const NOW = new Date("2026-11-19T14:00:00.000Z");

function health(incident: string | null = null): Health {
	return new Health(
		new FsStorage("/home/.splates", new FakeFs()).document("health.json"),
		async () => incident,
	);
}

async function fail(each: Health, minutes: number, model = "opus") {
	await each.hear(
		"claude",
		model,
		new Date(NOW.getTime() - minutes * 60_000).toISOString(),
		"API Error: 529 overloaded_error",
	);
}
