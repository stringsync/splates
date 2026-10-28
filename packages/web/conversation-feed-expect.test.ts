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

	it("holds a write pending without drawing it, until the server's copy holds it", async () => {
		const pin = write();

		const shown = feed.expect("c1", { pinned: true }, pin.done);
		expect(feed.pending("c1")).toBe(true);
		expect(feed.conversations[0]?.pinned).toBe(false);
		say(conversation({ title: "New" }));
		expect(feed.conversations[0]).toMatchObject({
			title: "New",
			pinned: false,
		});
		expect(feed.pending("c1")).toBe(true);

		pin.land();
		await shown;
		// Landed, but the server has yet to show it: no old state between.
		expect(feed.pending("c1")).toBe(true);
		say(conversation({ title: "New", pinned: true }));
		expect(feed.pending("c1")).toBe(false);
		expect(feed.conversations[0]?.pinned).toBe(true);
	});

	it("tells subscribers when a conversation becomes pending and when it stops", async () => {
		const seen: boolean[] = [];
		const stop = feed.subscribe(() => seen.push(feed.pending("c1")));
		const rename = write();

		const shown = feed.expect("c1", { name: "Login" }, rename.done);
		rename.land();
		await shown;
		say(conversation({ name: "Login" }));
		stop();

		expect(seen[0]).toBe(true);
		expect(seen.at(-1)).toBe(false);
	});

	it("keeps a write pending past its answer until the server's copy streams", async () => {
		const rename = write();

		const shown = feed.expect("c1", { name: "Login" }, rename.done);
		rename.land();
		await shown;
		expect(feed.pending("c1")).toBe(true);
		expect(feed.conversations[0]?.name).not.toBe("Login");

		say(conversation({ name: "Login (trimmed)" }));
		expect(feed.conversations[0]?.name).toBe("Login (trimmed)");
	});

	it("keeps a write pending past a listing that began before it landed", async () => {
		const archive = write();
		let answer = (_listing: Response) => {};
		globalThis.fetch = (async (_path: string, init?: RequestInit) =>
			init?.method === "POST"
				? new Response(null)
				: new Promise<Response>((resolve) => {
						answer = resolve;
					})) as unknown as typeof fetch;

		const listing = feed.refreshLimits();
		await new Promise((resolve) => setTimeout(resolve, 0));
		const shown = feed.expect("c1", { archived: true }, archive.done);
		archive.land();
		await shown;
		// The listing was asked for before the write landed, so it may predate it.
		answer(Response.json({ agents: [], conversations: [conversation({})] }));
		await listing;
		expect(feed.pending("c1")).toBe(true);
	});

	it("clears a refused write and rejects with why", async () => {
		const archive = write();

		const shown = feed.expect("c1", { archived: true }, archive.done);
		expect(feed.pending("c1")).toBe(true);
		archive.refuse("busy");

		await expect(shown).rejects.toThrow("busy");
		expect(feed.pending("c1")).toBe(false);
		expect(feed.conversations[0]?.archived).toBe(false);
	});

	it("reads a change given as a function against the server's latest copy", async () => {
		const change = write();

		void feed.expect(
			"c1",
			(state) => ({ ...state, name: `${state.title} renamed` }),
			change.done,
		);
		change.land();
		say(conversation({ title: "New" }));
		expect(feed.conversations[0]?.name).not.toBe("New renamed");
		expect(feed.pending("c1")).toBe(true);

		say(conversation({ title: "New", name: "New renamed" }));
		await Promise.resolve();
		expect(feed.pending("c1")).toBe(false);
	});
});
