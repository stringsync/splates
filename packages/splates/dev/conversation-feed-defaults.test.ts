import "./testing-dom";
import { afterEach, describe, expect, it } from "bun:test";
import { ConversationFeed } from "./conversation-feed";

describe("ConversationFeed saved defaults", () => {
	const originalFetch = globalThis.fetch;
	const OriginalSource = globalThis.EventSource;
	let feed: ConversationFeed;

	afterEach(() => {
		feed.dispose();
		globalThis.fetch = originalFetch;
		globalThis.EventSource = OriginalSource;
	});

	it("refreshes per-agent defaults and replaces stale OpenCode options", async () => {
		const listeners = new Map<string, () => void>();
		let current = "small";
		let goModels = ["opencode-go/first", "opencode-go/removed"];
		let requests = 0;
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
					{
						id: "opencode",
						name: "OpenCode",
						settings: [
							{
								id: "model",
								current: goModels[0],
								options: goModels.map((value) => ({
									value,
									name: "Shared",
									description: null,
								})),
							},
						],
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
		expect(feed.agents[0]?.settings[0]?.current).toBe("small");
		current = "big";
		listeners.get("settings")?.();
		await Bun.sleep(10);
		expect(requests).toBe(2);
		expect(feed.agents[0]?.settings[0]?.current).toBe("big");
		goModels = ["opencode-go/second"];
		listeners.get("settings")?.();
		await Bun.sleep(10);
		expect(
			feed.agents[1]?.settings[0]?.options.map((each) => each.value),
		).toEqual(goModels);
		expect(feed.agents[1]?.settings[0]?.current).toBe("opencode-go/second");
		expect(feed.agents[0]?.settings[0]?.current).toBe("big");
	});
});
