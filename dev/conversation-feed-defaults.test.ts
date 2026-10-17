import "./testing-dom";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { ConversationFeed } from "./conversation-feed";

describe("ConversationFeed saved defaults", () => {
	const originalFetch = globalThis.fetch;
	const OriginalSource = globalThis.EventSource;
	let feed: ConversationFeed;
	let listeners: Map<string, () => void>;
	let current: string;
	let requests: number;

	beforeEach(async () => {
		listeners = new Map();
		current = "small";
		requests = 0;
		globalThis.fetch = (async () => {
			requests++;
			return Response.json({
				agents: [
					{
						id: "codex",
						name: "Codex",
						settings: [{ id: "model", current }],
						limits: [],
					},
				],
				conversations: [],
			});
		}) as unknown as typeof fetch;
		globalThis.EventSource = class {
			onmessage = null;
			onopen = null;
			addEventListener(name: string, listener: () => void) {
				listeners.set(name, listener);
			}
			close() {}
		} as unknown as typeof EventSource;
		feed = new ConversationFeed();
		feed.start();
		await Bun.sleep(10);
	});

	afterEach(() => {
		feed.dispose();
		globalThis.fetch = originalFetch;
		globalThis.EventSource = OriginalSource;
	});

	it("refreshes the saved model after a selection on another page", async () => {
		expect(feed.agents[0]?.settings[0]?.current).toBe("small");
		current = "big";
		listeners.get("settings")?.();
		await Bun.sleep(10);
		expect(requests).toBe(2);
		expect(feed.agents[0]?.settings[0]?.current).toBe("big");
	});
});
