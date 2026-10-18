import { beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { FakePs } from "webappwiz/system/testing";
import { follow } from "./follow";
import { Testing } from "./testing";

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
			SPLATES_CONVERSATION: "c1",
			SPLATES_DEV: "http://localhost:4270",
		});

		await follow({ ps, log, send }, "alpha");
		await follow({ ps, log, send }, null, { from: "alpha" });
		await follow({ ps, log, send }, "part", { base: "task/alpha" });

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
			{
				url: "http://localhost:4270/api/conversations/c1/task",
				origin: "http://localhost:4270",
				body: { task: "part", base: "task/alpha" },
			},
		]);
		expect(log.entries).toEqual([]);
	});

	it("says nothing outside a conversation", async () => {
		await follow({ ps, log, send }, "alpha");

		expect(sent).toEqual([]);
	});

	it("notes a server that refuses or is gone, and goes on", async () => {
		ps.setEnv({
			SPLATES_CONVERSATION: "c1",
			SPLATES_DEV: "http://localhost:1",
		});
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
			"splates server did not move the conversation: 404",
			"splates server at http://localhost:1 could not be told of the move: refused",
		]);
	});

	it("is left out of a test's commands run from an agent in splates server", async () => {
		const outer = {
			SPLATES_CONVERSATION: process.env.SPLATES_CONVERSATION,
			SPLATES_DEV: process.env.SPLATES_DEV,
		};
		process.env.SPLATES_CONVERSATION = "c1";
		process.env.SPLATES_DEV = "http://localhost:4270";
		try {
			await using testing = await Testing.open({ init: false });

			expect(testing.ps.env("SPLATES_CONVERSATION")).toBeUndefined();
			expect(testing.ps.env("SPLATES_DEV")).toBeUndefined();
		} finally {
			for (const [name, value] of Object.entries(outer)) {
				if (value === undefined) {
					delete process.env[name];
				} else {
					process.env[name] = value;
				}
			}
		}
	});
});
