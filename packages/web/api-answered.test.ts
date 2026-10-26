import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Duration } from "webappwiz/time";
import { ApiError, answered, answeredFrom, expiring, send } from "./api";
import { EarlyReads } from "./early-reads";
import { Testing } from "./testing";

describe("answered", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
		testing.answerWithin(Duration.ms(50));
	});

	afterEach(() => testing.dispose());

	it("gives up on a read the server never answers, saying how long it waited", async () => {
		testing.hang("/api/stats");

		const read = answered("/api/stats", { within: Duration.ms(80) });

		await expect(read).rejects.toEqual(
			new ApiError("timeout", "no answer in 80ms"),
		);
	});

	it("gives up on an action as a refusal, by the page's wait unless given", async () => {
		testing.holdWrites();

		const action = send("/api/todos", { body: "{}" });

		await expect(action).rejects.toHaveProperty("reason", "timeout");
	});

	it("answers as fetch does when the server answers in time", async () => {
		const response = await answered("/api/stats");

		expect(response.ok).toBe(true);
	});

	it("times out as AbortSignal.timeout does, unless disposed first, as answered does once answered", async () => {
		// `AbortSignal.timeout`'s timer ran the whole wait, holding the request
		// and its page: a test worker carried 30 s of them.
		const expired = expiring(Duration.ms(10));
		const stopped = expiring(Duration.ms(10));
		stopped[Symbol.dispose]();

		await Bun.sleep(40);

		expect(expired.signal.aborted).toBe(true);
		expect(expired.signal.reason).toHaveProperty("name", "TimeoutError");
		expect(stopped.signal.aborted).toBe(false);
	});

	it("gives up on a read index.html started, which the page cannot abort", async () => {
		const early = new EarlyReads({
			splatesEarly: new Map([["/api/snapshot", new Promise(() => {})]]),
		});

		await expect(early.fetch("/api/snapshot")).rejects.toHaveProperty(
			"reason",
			"timeout",
		);
		await expect(
			answeredFrom(Promise.resolve(new Response("ok"))),
		).resolves.toBeInstanceOf(Response);
	});
});
