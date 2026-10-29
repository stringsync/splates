import { describe, expect, it } from "bun:test";
import type { ConversationState } from "@stringsync/splates-server/conversations";
import "./register-dom";
import type { ConversationFeed } from "./conversation-feed";
import { ShipStart, type ShipStartServer } from "./ship-start";

describe("ShipStart", () => {
	it("plans the run, then starts a General conversation told which run to drive", async () => {
		const calls: string[] = [];
		const server: ShipStartServer = {
			startRun: async (projects) => {
				calls.push(`run ${projects.join(",")}`);
				return "run-7";
			},
			startConversation: async (agent) => {
				calls.push(`conversation ${agent}`);
				return { id: "c9" } as ConversationState;
			},
			attach: async (conversation) => {
				calls.push(`attach ${conversation}`);
			},
			prompt: async (conversation, text) => {
				calls.push(`prompt ${conversation} ${text}`);
			},
		};
		const feed = {
			agents: [{ id: "claude" }],
			conversations: [],
		} as unknown as ConversationFeed;
		history.replaceState(null, "", "/?ship=webappwiz#ships");
		const url = await new ShipStart(feed, server).begin(["webappwiz"]);
		expect(calls).toEqual([
			"run webappwiz",
			"conversation claude",
			"attach c9",
			"prompt c9 [SPLATES SHIP run-7]",
		]);
		const opened = new URL(url);
		expect(opened.searchParams.get("project")).toBe("~general");
		expect(opened.searchParams.has("ship")).toBe(false);
		expect(opened.hash).toBe("#conversations/c9");
		history.replaceState(null, "", "/");
	});

	it("starts no conversation when the run is refused", async () => {
		const server: ShipStartServer = {
			startRun: async () => {
				throw new Error("a ship is running");
			},
			startConversation: async () => {
				throw new Error("not reached");
			},
			attach: async () => {},
			prompt: async () => {},
		};
		const feed = {
			agents: [],
			conversations: [],
		} as unknown as ConversationFeed;
		await expect(new ShipStart(feed, server).begin(["a"])).rejects.toThrow(
			"a ship is running",
		);
	});
});
