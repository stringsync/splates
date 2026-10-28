import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { ConversationState } from "@stringsync/splates-server/conversations";
import { CounterIdProvider } from "webappwiz/id";
import { FakeTimer } from "webappwiz/time/testing";
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
	let timer: FakeTimer;

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
		timer = new FakeTimer();
		feed = new ConversationFeed(timer, undefined, new CounterIdProvider());
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

	it("merges streamed deltas over its wire copy while retaining optimistic messages", async () => {
		feed.start();
		await list([]);
		const state = conversation({
			messages: [message("user", "old"), message("agent", "answer")],
		});
		say(state);
		const unchanged = feed.conversations[0]?.messages[0];
		feed.send("c1", "pending");
		state.messages[1]?.parts.push({ type: "text", text: " more" });
		stream?.named.get("delta")?.({
			data: JSON.stringify({
				id: state.id,
				changes: {},
				removed: [],
				messages: { length: 2, replace: [[1, state.messages[1]]] },
			}),
		});
		timer.fireTimeouts();
		expect(feed.conversations[0]?.messages[0]).toBe(unchanged);
		expect(feed.conversations[0]?.messages[1]).toEqual(state.messages[1]);
		expect(feed.conversations[0]?.messages).toHaveLength(3);
	});

	it("draws streamed deltas together, each still applied to the one before", async () => {
		feed.start();
		await list([]);
		say(conversation({ name: "first" }));
		const draw = (name: string) =>
			stream?.named.get("delta")?.({
				data: JSON.stringify({ id: "c1", changes: { name }, removed: [] }),
			});
		draw("second");
		draw("third");
		expect(feed.conversations[0]?.name).toBe("first");
		expect(feed.current("c1")?.name).toBe("third");
		timer.fireTimeouts();
		expect(feed.conversations[0]?.name).toBe("third");
	});

	it("keeps the wire baseline apart from a newer HTTP listing", async () => {
		feed.start();
		await list([]);
		const state = conversation({ messages: [message("agent", "old")] });
		say(state);
		stream?.named.get("settings")?.({ data: "{}" });
		await list([
			conversation({ messages: [message("agent", "newer listing")] }),
		]);
		state.name = "changed";
		stream?.named.get("delta")?.({
			data: JSON.stringify({
				id: state.id,
				changes: { name: state.name },
				removed: [],
			}),
		});
		timer.fireTimeouts();
		expect(feed.conversations[0]?.messages).toEqual(state.messages);
		expect(feed.conversations[0]?.name).toBe("changed");
	});

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
		say({
			...idle,
			status: "running",
			messages: [{ ...message("user", "second"), id: second.id }],
		});

		expect(feed.sending.has("c1")).toBe(false);
		expect(feed.conversations[0]?.messages).toHaveLength(1);
		expect(second.queued).toBe(true);
		feed.take("c1", refused);
		expect(feed.unsent.has("c1")).toBe(false);
	});

	it("places a message by how the server says it will take one, as the server changes its mind", async () => {
		const running = conversation({
			status: "running",
			taking: "steer",
			messages: [message("user", "go")],
		});
		feed.start();
		await list([running]);

		const steered = feed.send("c1", "now");
		say({ ...running, taking: "queue" });
		const queued = feed.send("c1", "later");
		say({ ...running, taking: "start" });
		const started = feed.send("c1", "then");

		expect(steered.queued).toBe(false);
		expect(queued.queued).toBe(true);
		// Behind a message on its way, whatever the server says.
		expect(started.queued).toBe(true);
	});

	it("keeps a message on its way while the server records one told, and drops it once its own copy comes", async () => {
		const running = conversation({
			status: "running",
			taking: "queue",
			messages: [message("user", "go")],
		});
		feed.start();
		await list([running]);
		const sent = feed.send("c1", "and the logout");
		const told = {
			...message("user", "carry on"),
			told: "c2",
			queued: true as const,
		};

		say({ ...running, messages: [...running.messages, told] });

		expect(feed.conversations[0]?.messages).toEqual([
			message("user", "go"),
			told,
			expect.objectContaining({ id: sent.id, queued: true }),
		]);
		expect(feed.unrecorded("c1")).toBe(1);

		const recorded = {
			...message("user", "and the logout"),
			queued: true as const,
			id: sent.id,
		};
		say({ ...running, messages: [...running.messages, told, recorded] });

		expect(feed.sending.has("c1")).toBe(false);
		expect(feed.unrecorded("c1")).toBe(0);
		expect(feed.conversations[0]?.messages).toEqual([
			message("user", "go"),
			told,
			recorded,
		]);
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

	it("retries hydration when another summary arrives while the body is being read", async () => {
		const summary = conversation({ summary: true });
		feed.start();
		await list([summary]);
		let answer: ((state: ConversationState) => void) | undefined;
		const whole = conversation({ messages: [message("agent", "Whole")] });
		let requests = 0;
		globalThis.fetch = (() => {
			requests++;
			return Promise.resolve(
				requests === 1
					? {
							ok: true,
							json: () =>
								new Promise<ConversationState>((resolve) => {
									answer = resolve;
								}),
						}
					: Response.json(whole),
			);
		}) as unknown as typeof fetch;
		const reading = feed.whole("c1");
		await waitUntil(() => answer !== undefined);
		say({ ...summary, name: "new summary" });
		answer?.(whole);
		await reading;
		expect(requests).toBe(2);
		expect(feed.conversations[0]).toEqual(whole);
	});

	it.each([false, true])(
		"reads a summary whole once, with archived=%s",
		async (archived) => {
			const summary = conversation({ id: "c1", archived, summary: true });
			const whole = conversation({
				id: "c1",
				archived,
				messages: [message("agent", "Done.")],
			});
			feed.start();
			await list([summary, conversation({ id: "c2" })]);
			const asked: string[] = [];
			globalThis.fetch = ((url: string) => {
				asked.push(url);
				return Promise.resolve(Response.json(whole));
			}) as unknown as typeof fetch;

			await Promise.all([feed.whole("c1"), feed.whole("c1"), feed.whole("c2")]);

			expect(asked).toEqual(["/api/conversations/c1"]);
			expect(feed.conversations[0]).toEqual(whole);
		},
	);
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
