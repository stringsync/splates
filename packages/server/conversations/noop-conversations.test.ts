import { describe, expect, test } from "bun:test";
import { NoopConversations } from "./noop-conversations";

describe("NoopConversations", () => {
	test("lists no conversations", async () => {
		const conversations = new NoopConversations();

		expect(await conversations.list()).toEqual([]);
	});

	test("disposes without anything to dispose", async () => {
		const conversations = new NoopConversations();

		await conversations.disposeAsync();
	});
});
