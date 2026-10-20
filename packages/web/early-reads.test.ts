import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { EarlyReads } from "./early-reads";

describe("EarlyReads", () => {
	const fetched = globalThis.fetch;
	let asked: string[];

	beforeEach(() => {
		asked = [];
		globalThis.fetch = (async (url: string) => {
			asked.push(url);
			return new Response("fetched");
		}) as unknown as typeof fetch;
	});

	afterEach(() => {
		globalThis.fetch = fetched;
	});

	it("takes the read index.html started for an address once, then fetches", async () => {
		const reads = new EarlyReads({
			splatesEarly: new Map([
				["/api/snapshot", Promise.resolve(new Response("early"))],
			]),
		});

		expect(await (await reads.fetch("/api/snapshot")).text()).toBe("early");
		expect(await (await reads.fetch("/api/snapshot")).text()).toBe("fetched");
		expect(asked).toEqual(["/api/snapshot"]);
	});

	it("fetches an address index.html never started", async () => {
		const reads = new EarlyReads({
			splatesEarly: new Map([
				["/api/snapshot", Promise.resolve(new Response("early"))],
			]),
		});

		expect(await (await reads.fetch("/api/snapshot?project=shop")).text()).toBe(
			"fetched",
		);
	});

	it("fetches every address when index.html started none", async () => {
		const reads = new EarlyReads({});

		await reads.fetch("/api/conversations");

		expect(asked).toEqual(["/api/conversations"]);
	});
});
