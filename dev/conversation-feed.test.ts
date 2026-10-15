import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { ConversationState } from "../conversations";
import { ConversationFeed } from "./conversation-feed";
import { conversation, message } from "./testing";

/** The stream the feed opened, to say what the server would. */
interface Stream {
	onmessage: ((event: { data: string }) => void) | null;
	onopen: (() => void) | null;
	named: Map<string, (event: { data: string }) => void>;
}

describe("ConversationFeed", () => {
	const fetched = globalThis.fetch;
	const Source = globalThis.EventSource;
	/** Each listing asked for and not yet answered, in the order asked. */
	let listings: ((conversations: ConversationState[]) => void)[];
	let stream: Stream | null;
	let feed: ConversationFeed;

	beforeEach(() => {
		listings = [];
		stream = null;
		globalThis.fetch = (() =>
			new Promise<Response>((resolve) =>
				listings.push((conversations) =>
					resolve(Response.json({ agents: [], conversations })),
				),
			)) as unknown as typeof fetch;
		globalThis.EventSource = class {
			onmessage = null;
			onopen = null;
			readonly named = new Map();
			constructor() {
				stream = this;
			}
			addEventListener(
				name: string,
				listener: (event: { data: string }) => void,
			): void {
				this.named.set(name, listener);
			}
			close(): void {}
		} as unknown as typeof EventSource;
		feed = new ConversationFeed();
	});

	afterEach(() => {
		feed.dispose();
		globalThis.fetch = fetched;
		globalThis.EventSource = Source;
	});

	/** Answers the oldest listing asked for with `conversations`. */
	async function list(conversations: ConversationState[]): Promise<void> {
		await waitUntil(() => listings.length > 0);
		listings.shift()?.(conversations);
		await settled();
	}

	/** Streams `state`, as the server does when a conversation moves. */
	function say(state: ConversationState): void {
		stream?.onmessage?.({ data: JSON.stringify(state) });
	}

	it("shows a refused message apart, so one sent after it goes once the server has that one", async () => {
		const idle = conversation({ status: "idle", messages: [] });
		feed.start();
		await list([idle]);
		const refused = feed.send("c1", "first");
		const second = feed.send("c1", "second");

		feed.refused("c1", refused, new Error("not now"));
		expect(feed.unsent.get("c1")).toEqual([
			{ message: refused, why: "not now" },
		]);
		expect(feed.conversations[0]?.messages).toEqual([
			expect.objectContaining({ queued: true }),
		]);
		say({ ...idle, status: "running", messages: [message("user", "second")] });

		expect(feed.sending.has("c1")).toBe(false);
		expect(feed.conversations[0]?.messages).toHaveLength(1);
		expect(second.queued).toBe(true);
		feed.take("c1", refused);
		expect(feed.unsent.has("c1")).toBe(false);
	});

	it("keeps what streamed while it read every conversation again", async () => {
		const before = conversation({ id: "c1" });
		const after = conversation({
			id: "c1",
			status: "running",
			messages: [message("user", "hello")],
		});
		feed.start();
		await list([before]);

		// The stream opens and reads them all again, and a message is said
		// before that answers, with what the server held a moment before.
		stream?.onopen?.();
		say(after);
		await list([before]);

		expect(feed.conversations).toEqual([after]);
	});

	it("keeps a conversation started, and leaves out one deleted, while it read them again", async () => {
		const kept = conversation({ id: "c1", createdAt: "2026-01-01T00:00:00Z" });
		const deleted = conversation({
			id: "c2",
			createdAt: "2026-01-02T00:00:00Z",
		});
		const started = conversation({
			id: "c3",
			createdAt: "2026-01-03T00:00:00Z",
		});
		feed.start();
		await list([deleted, kept]);

		stream?.onopen?.();
		say(started);
		stream?.named.get("removed")?.({ data: "c2" });
		await list([deleted, kept]);

		expect(feed.conversations).toEqual([started, kept]);
	});

	it("takes what it read again for a conversation that has not streamed since", async () => {
		const before = conversation({ id: "c1" });
		const after = conversation({ id: "c1", name: "Renamed" });
		feed.start();
		await list([before]);

		stream?.onopen?.();
		await list([after]);

		expect(feed.conversations).toEqual([after]);
	});
});

async function settled(): Promise<void> {
	for (let turn = 0; turn < 10; turn++) {
		await Promise.resolve();
	}
}

async function waitUntil(ready: () => boolean): Promise<void> {
	for (let turn = 0; turn < 100 && !ready(); turn++) {
		await Promise.resolve();
	}
}
