import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	type ConversationsView,
	cleanup,
	conversation,
	fireEvent,
	message,
	newWith,
	Testing,
	textIn,
	typeIn,
	waitFor,
} from "./testing";

describe("App's new conversation, held in its composer until the server answers", () => {
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

	it("keeps its composer busy while the start is on its way, then opens its thread and sends", async () => {
		await waitFor(() =>
			expect(view.getByRole("button", { name: "Starting…" })).toBeTruthy(),
		);
		expect(view.getByRole("region", { name: "new conversation" })).toBeTruthy();
		expect(location.hash).not.toBe("#conversations/c9");
		expect(view.queryByRole("region", { name: "fix the login" })).toBeNull();
		expect(testing.posted("/api/conversations")).toHaveLength(1);
		expect(testing.posted("/api/conversations/c9/prompt")).toHaveLength(0);

		await act(async () => testing.release());

		await waitFor(() => expect(location.hash).toBe("#conversations/c9"));
		await waitFor(() =>
			expect(testing.posted("/api/conversations/c9/prompt")).toHaveLength(1),
		);
		// Named once the server has the message, which waits in the pending row.
		expect(view.getByRole("list", { name: "messages sending" })).toBeTruthy();
		await testing.say(
			conversation({
				id: "c9",
				status: "running",
				messages: [
					{
						...message("user", "fix the login"),
						id: testing.sentId("c9", "fix the login"),
					},
				],
			}),
		);
		await waitFor(() =>
			expect(view.getByRole("region", { name: "fix the login" })).toBeTruthy(),
		);
	});

	it("keeps what the server streamed of it over the start's answer, which can be older", async () => {
		await testing.say(
			conversation({ id: "c9", title: "Login fix", status: "running" }),
		);
		const nav = () => view.getByRole("navigation", { name: "conversations" });
		await waitFor(() => expect(nav().textContent).toContain("Login fix"));

		await act(async () => testing.release());

		await waitFor(() =>
			expect(testing.posted("/api/conversations/c9/prompt")).toHaveLength(1),
		);
		expect(nav().textContent).toContain("Login fix");
	});

	it("gives its composer back the words and why, when the start is refused", async () => {
		testing.refuseWrites = { reason: "usage", message: "no such agent" };

		await act(async () => testing.release());

		await waitFor(() =>
			expect(view.getByText("Not started: no such agent")).toBeTruthy(),
		);
		expect(location.hash).not.toBe("#conversations/c9");
		expect(textIn(view.getByRole("textbox", { name: "Message input" }))).toBe(
			"fix the login",
		);
		expect(view.getByRole("button", { name: "Send message" })).toBeTruthy();
		expect(view.queryByRole("region", { name: "fix the login" })).toBeNull();
		expect(testing.posted("/api/conversations/c9/prompt")).toHaveLength(0);
	});
});
