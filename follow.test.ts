import { beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { FakePs } from "webappwiz/system/testing";
import { follow } from "./follow";

describe("follow", () => {
	let ps: FakePs;
	let log: MemoryLogger;
	let sent: { url: string; origin: string | null; body: unknown }[];
	let status: number;

	beforeEach(() => {
		ps = new FakePs();
		log = new MemoryLogger();
		sent = [];
		status = 200;
	});

	const send = async (url: string, init: RequestInit) => {
		sent.push({
			url,
			origin: new Headers(init.headers).get("origin"),
			body: JSON.parse(String(init.body)),
		});
		return new Response("{}", { status });
	};

	it("tells the server in the env which task the conversation is in now", async () => {
		ps.setEnv({
			ARBOR_CONVERSATION: "c1",
			ARBOR_DEV: "http://localhost:4270",
		});

		await follow({ ps, log, send }, "alpha");
		await follow({ ps, log, send }, null, "alpha");

		expect(sent).toEqual([
			{
				url: "http://localhost:4270/api/conversations/c1/task",
				origin: "http://localhost:4270",
				body: { task: "alpha" },
			},
			{
				url: "http://localhost:4270/api/conversations/c1/task",
				origin: "http://localhost:4270",
				body: { task: null, from: "alpha" },
			},
		]);
		expect(log.entries).toEqual([]);
	});

	it("says nothing outside a conversation", async () => {
		await follow({ ps, log, send }, "alpha");

		expect(sent).toEqual([]);
	});

	it("notes a server that refuses or is gone, and goes on", async () => {
		ps.setEnv({ ARBOR_CONVERSATION: "c1", ARBOR_DEV: "http://localhost:1" });
		status = 404;

		await follow({ ps, log, send }, "alpha");
		await follow(
			{
				ps,
				log,
				send: () => Promise.reject(new Error("refused")),
			},
			"alpha",
		);

		expect(log.entries.map((entry) => String(entry.message))).toEqual([
			"arbor dev did not move the conversation: 404",
			"arbor dev at http://localhost:1 could not be told of the move: refused",
		]);
	});
});
