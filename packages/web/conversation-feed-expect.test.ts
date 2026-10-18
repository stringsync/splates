import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { ConversationState } from "@stringsync/splates-server/conversations";
import { ConversationFeed } from "./conversation-feed";
import { conversation } from "./testing";

describe("ConversationFeed's expect", () => {
	const fetched = globalThis.fetch;
	const Source = globalThis.EventSource;
	/** The stream the feed opened, to say what the server would. */
	let stream: { onmessage: ((event: { data: string }) => void) | null } | null;
	let feed: ConversationFeed;

	beforeEach(async () => {
		stream = null;
		globalThis.fetch = (async () =>
			Response.json({
				agents: [],
				conversations: [conversation({ title: "Old" })],
			})) as unknown as typeof fetch;
		globalThis.EventSource = class {
			onmessage = null;
			onopen = null;
			constructor() {
				stream = this;
			}
			addEventListener(): void {}
			close(): void {}
		} as unknown as typeof EventSource;
		feed = new ConversationFeed();
		feed.start();
		for (let turn = 0; turn < 100 && stream === null; turn++) {
			await Promise.resolve();
		}
	});

	afterEach(() => {
		feed.dispose();
		globalThis.fetch = fetched;
		globalThis.EventSource = Source;
	});

	/** Streams `state`, as the server does when a conversation moves. */
	function say(state: ConversationState): void {
		stream?.onmessage?.({ data: JSON.stringify(state) });
	}

	/** A write the test answers, as the server would. */
	function write(): {
		done: Promise<void>;
		land: () => void;
		refuse: (why: string) => void;
	} {
		let land = () => {};
		let refuse = (_why: string) => {};
		const done = new Promise<void>((resolve, reject) => {
			land = resolve;
			refuse = (why) => reject(new Error(why));
		});
		return { done, land, refuse };
	}

	it("shows an expected change at once, over what streams meanwhile, until the server's copy holds it", async () => {
		const pin = write();

		const shown = feed.expect("c1", { pinned: true }, pin.done);
		expect(feed.conversations[0]?.pinned).toBe(true);
		say(conversation({ title: "New" }));
		expect(feed.conversations[0]).toMatchObject({
			title: "New",
			pinned: true,
		});

		say(conversation({ title: "New", pinned: true }));
		pin.land();
		await shown;
		say(conversation({ title: "New" }));
		expect(feed.conversations[0]?.pinned).toBe(false);
	});

	it("keeps an expected change past its answer until the server's copy streams", async () => {
		const rename = write();

		const shown = feed.expect("c1", { name: "Login" }, rename.done);
		rename.land();
		await shown;
		expect(feed.conversations[0]?.name).toBe("Login");

		say(conversation({ name: "Login (trimmed)" }));
		expect(feed.conversations[0]?.name).toBe("Login (trimmed)");
	});

	it("takes back a refused change and rejects with why", async () => {
		const archive = write();

		const shown = feed.expect("c1", { archived: true }, archive.done);
		expect(feed.conversations[0]?.archived).toBe(true);
		archive.refuse("busy");

		await expect(shown).rejects.toThrow("busy");
		expect(feed.conversations[0]?.archived).toBe(false);
	});

	it("applies a change given as a function to the server's latest copy", async () => {
		const change = write();

		void feed.expect(
			"c1",
			(state) => ({ ...state, name: `${state.title} renamed` }),
			change.done,
		);
		say(conversation({ title: "New" }));

		expect(feed.conversations[0]?.name).toBe("New renamed");
	});
});
