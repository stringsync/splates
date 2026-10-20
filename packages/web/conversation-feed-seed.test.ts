import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { ConversationFeed } from "./conversation-feed";
import { conversation } from "./testing";

describe("ConversationFeed's seed", () => {
	const fetched = globalThis.fetch;
	const Source = globalThis.EventSource;
	let feed: ConversationFeed;

	beforeEach(() => {
		globalThis.fetch = (async () =>
			Response.json({
				agents: [],
				conversations: [conversation({ id: "c1", name: "Listed" })],
			})) as unknown as typeof fetch;
		globalThis.EventSource = class {
			addEventListener(): void {}
			close(): void {}
		} as unknown as typeof EventSource;
		feed = new ConversationFeed(undefined, undefined, undefined, {
			project: "shop",
		});
	});

	afterEach(() => {
		feed.dispose();
		globalThis.fetch = fetched;
		globalThis.EventSource = Source;
	});

	it("shows the seed until the project's own listing arrives", async () => {
		feed.seed([conversation({ id: "c1", name: "Seeded" })]);
		expect(feed.conversations.map((each) => each.name)).toEqual(["Seeded"]);
		expect(feed.loading).toBe(false);
		expect(feed.available).toBe(true);

		feed.start();

		await Bun.sleep(0);
		expect(feed.conversations.map((each) => each.name)).toEqual(["Listed"]);
	});

	it("drops the seed of a project whose conversations are off", async () => {
		globalThis.fetch = (async () =>
			new Response(null, { status: 404 })) as unknown as typeof fetch;
		feed.seed([conversation({ id: "c1", name: "Seeded" })]);

		feed.start();

		await Bun.sleep(0);
		expect(feed.conversations).toEqual([]);
		expect(feed.available).toBe(false);
	});

	it("keeps what it listed over a later seed", async () => {
		feed.start();
		await Bun.sleep(0);

		feed.seed([conversation({ id: "c2", name: "Seeded" })]);

		expect(feed.conversations.map((each) => each.name)).toEqual(["Listed"]);
	});
});
