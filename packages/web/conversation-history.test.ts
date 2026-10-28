import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { listed } from "@stringsync/splates-server/conversations/browser";
import { ConversationFeed } from "./conversation-feed";
import { conversation, message, Testing, waitFor } from "./testing";

describe("Complete conversation reads", () => {
	let testing: Testing;
	let feed: ConversationFeed;
	let release: () => void;
	beforeEach(() => {
		testing = new Testing();
		feed = new ConversationFeed();
		const old = conversation({ messages: [message("agent", "Old answer")] });
		feed.seed([listed(old)]);
		testing.wholes.c1 = old;
		release = testing.holdHistory("c1");
	});
	afterEach(() => {
		feed.dispose();
		testing.dispose();
	});

	it("shares pending reads and lets all callers observe a retryable failure", async () => {
		testing.wholes.c1 = 503;
		const first = feed.whole("c1");
		expect(feed.whole("c1")).toBe(first);
		release();
		await first;
		expect(feed.history.failure("c1")).toContain("Couldn't load");
		testing.wholes.c1 = conversation();
		await feed.whole("c1");
		expect(feed.history.failure("c1")).toBeNull();
		expect(feed.current("c1")?.summary).toBeUndefined();
	});

	it("does not bring back a conversation removed during its read", async () => {
		testing.wholes.c1 = conversation();
		const reading = feed.whole("c1");
		feed.drop("c1");
		release();
		await reading;
		expect(feed.conversations).toEqual([]);
		expect(feed.history.kept("c1")).toBeUndefined();
	});

	it("ignores a read from a disposed feed", async () => {
		testing.wholes.c1 = conversation();
		const reading = feed.whole("c1");
		feed.dispose();
		release();
		await reading;
		expect(feed.current("c1")?.summary).toBe(true);
		expect(feed.history.kept("c1")).toBeUndefined();
	});

	it("keeps same-id histories isolated by project when the old request finishes last", async () => {
		const other = new ConversationFeed(undefined, undefined, undefined, {
			project: "other",
		});
		try {
			testing.wholes.c1 = conversation({ title: "Old project" });
			const reading = feed.whole("c1");
			other.seed([listed(conversation())]);
			testing.wholes.c1 = conversation({ title: "Other project" });
			const releaseOther = testing.holdHistory("c1");
			const second = other.whole("c1");
			releaseOther();
			await second;
			release();
			await reading;
			expect(other.history.kept("c1")?.title).toBe("Other project");
			expect(feed.history.kept("c1")?.title).toBe("Old project");
			expect(testing.asked).toContain("/api/conversations/c1?project=other");
		} finally {
			other.dispose();
		}
	});

	it("does not let an old history overwrite a newer reconnect listing", async () => {
		const newer = conversation({ messages: [message("agent", "New answer")] });
		const reading = feed.whole("c1");
		testing.talk = { agents: [], conversations: [listed(newer)] };
		feed.start();
		await waitFor(() =>
			expect(feed.current("c1")?.messages).toEqual(newer.messages),
		);
		testing.wholes.c1 = newer;
		release();
		await reading;
		expect(feed.history.kept("c1")?.messages).toEqual(newer.messages);
		expect(
			testing.asked.filter((path) => path === "/api/conversations/c1"),
		).toHaveLength(2);
	});

	it("bounds retries when summaries keep changing during reads", async () => {
		testing.wholes.c1 = conversation();
		const reading = feed.whole("c1");
		// scry-ignore matchers-over-test-logic: each round holds the next HTTP response until a newer summary arrives
		for (let attempt = 1; attempt <= 3; attempt++) {
			await waitFor(() =>
				expect(
					testing.asked.filter((path) => path === "/api/conversations/c1"),
				).toHaveLength(attempt),
			);
			feed.put(listed(conversation({ title: `Revision ${attempt}` })));
			const next = testing.holdHistory("c1");
			release();
			release = next;
		}
		await reading;
		expect(feed.history.failure("c1")).toContain("changed while loading");
		expect(feed.current("c1")?.summary).toBe(true);
	});

	// scry-ignore simple-test-setup: these transitions are unique to testing pending state over a retained complete body
	it("keeps pending writes held and sends visible over retained history during refresh", async () => {
		const old = conversation({ messages: [message("agent", "Old answer")] });
		feed.put(old);
		feed.put(listed({ ...old, title: "Refreshed title" }));
		let finish = () => {};
		const writing = feed.expect(
			"c1",
			{ pinned: true },
			new Promise<void>((resolve) => {
				finish = resolve;
			}),
		);
		const sending = feed.send("c1", "New prompt");
		const shown = feed.conversations.map((state) => feed.history.shown(state));
		expect(shown).toMatchObject([
			{
				title: "Refreshed title",
				pinned: false,
				messages: [
					old.messages[0],
					{ id: sending.id, parts: [{ type: "text", text: "New prompt" }] },
				],
			},
		]);
		expect(feed.pending("c1")).toBe(true);
		feed.refused("c1", sending, new Error("Not sent"));
		expect(
			feed.conversations.map((state) => feed.history.shown(state).messages),
		).toEqual([old.messages]);
		finish();
		await writing;
	});
	it("keeps an archived conversation's menus, which its listing leaves out, once read whole", () => {
		const commands = [{ name: "review", description: "Review it", hint: null }];
		const whole = conversation({ archived: true, commands });
		feed.put(whole);
		const listing = listed({ ...whole, title: "Renamed" });
		feed.put(listing);
		expect(listing.commands).toEqual([]);
		expect(feed.history.shown(listing)).toMatchObject({
			title: "Renamed",
			commands,
		});
	});
});
