import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	type ConversationsView,
	cleanup,
	conversation,
	fireEvent,
	newWith,
	Testing,
	textIn,
	typeIn,
	waitFor,
} from "./testing";

describe("App's new conversation, opened before the server answers", () => {
	let testing: Testing;
	let view: ConversationsView;

	beforeEach(async () => {
		testing = new Testing();
		view = await testing.openConversations([], null);
		await newWith(view, "Claude");
		testing.reply = conversation({ id: "c9", status: "starting" });
		testing.holdWrites();
		const box = view.getByRole("textbox", { name: "Message input" });
		await typeIn(box, "fix the login");
		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("opens its thread on the first message while the start is on its way, then sends it", async () => {
		await waitFor(() =>
			expect(view.getByRole("region", { name: "fix the login" })).toBeTruthy(),
		);
		expect(location.hash).toBe("#conversations/c9");
		expect(testing.posted("/api/conversations")).toHaveLength(1);
		expect(testing.posted("/api/conversations/c9/prompt")).toHaveLength(0);

		await act(async () => testing.release());

		await waitFor(() =>
			expect(testing.posted("/api/conversations/c9/prompt")).toHaveLength(1),
		);
	});

	it("goes back to its composer with the words and why, when the start is refused", async () => {
		await waitFor(() => expect(location.hash).toBe("#conversations/c9"));
		testing.refuseWrites = { reason: "usage", message: "no such agent" };

		await act(async () => testing.release());

		await waitFor(() =>
			expect(view.getByText("Not started: no such agent")).toBeTruthy(),
		);
		expect(location.hash).not.toBe("#conversations/c9");
		expect(textIn(view.getByRole("textbox", { name: "Message input" }))).toBe(
			"fix the login",
		);
		expect(view.queryByRole("region", { name: "fix the login" })).toBeNull();
		expect(testing.posted("/api/conversations/c9/prompt")).toHaveLength(0);
	});
});
