import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { ConversationState } from "@stringsync/splates-server/conversations";
import { listed } from "@stringsync/splates-server/conversations/browser";
import { Duration } from "webappwiz/time";
import {
	act,
	cleanup,
	conversation,
	fireEvent,
	message,
	openRow,
	resize,
	Testing,
	tool,
	typeIn,
	waitFor,
	within,
} from "./testing";

describe("Opening complete conversation history", () => {
	let testing: Testing;
	let whole: ConversationState;
	let release: () => void;
	beforeEach(() => {
		testing = new Testing();
		whole = conversation({
			title: "History",
			messages: [
				message("user", "Read the file"),
				message("agent", tool(), "Finished reading"),
			],
		});
		testing.wholes.c1 = whole;
		release = testing.holdHistory("c1");
	});
	afterEach(() => {
		cleanup();
		testing.dispose();
		resize(1024, 768);
	});

	it.each([1024, 390])(
		"reveals text and work together at width %s without replacing the draft",
		async (width) => {
			resize(width, 844);
			const view = await testing.openConversations([listed(whole)]);
			const thread = within(view.getByRole("region", { name: "History" }));
			expect(thread.getByText("Loading conversation")).toBeTruthy();
			expect(thread.queryByText("Finished reading")).toBeNull();
			expect(thread.queryByText("How can I help you today?")).toBeNull();
			const box = thread.getByRole("textbox", { name: "Message input" });
			await typeIn(box, "Keep my draft");
			await act(async () => release());
			await waitFor(() =>
				expect(thread.getByText("Finished reading")).toBeTruthy(),
			);
			expect(thread.getByText("Worked")).toBeTruthy();
			expect(thread.queryByText("Loading conversation")).toBeNull();
			expect(thread.getByRole("textbox", { name: "Message input" })).toBe(box);
			expect(box.textContent).toBe("Keep my draft");
			expect(
				testing.asked.filter((path) => path === "/api/conversations/c1"),
			).toHaveLength(1);
		},
	);

	it.each([503, 404])(
		"offers a retry after history returns %s and distinguishes empty history",
		async (status) => {
			release();
			testing.wholes.c1 = status;
			const view = await testing.openConversations([listed(whole)]);
			await waitFor(() =>
				expect(
					view.getByRole("button", { name: "Retry history" }),
				).toBeTruthy(),
			);
			expect(view.getByRole("alert").textContent).toContain(
				status === 404 ? "no longer available" : "Couldn't load",
			);
			expect(view.queryByText("How can I help you today?")).toBeNull();
			testing.wholes.c1 = { ...whole, messages: [] };
			await act(async () =>
				fireEvent.click(view.getByRole("button", { name: "Retry history" })),
			);
			await waitFor(() =>
				expect(view.getByText("How can I help you today?")).toBeTruthy(),
			);
			expect(view.queryByRole("button", { name: "Retry history" })).toBeNull();
		},
	);

	it("allows retrying a stalled read", async () => {
		testing.answerWithin(Duration.ms(30));
		const view = await testing.openConversations([listed(whole)]);
		await waitFor(() =>
			expect(view.getByRole("button", { name: "Retry history" })).toBeTruthy(),
		);
		release();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Retry history" })),
		);
		await waitFor(() =>
			expect(view.getByText("Finished reading")).toBeTruthy(),
		);
	});

	// scry-ignore simple-test-setup: the newer listing and full starting state are specific to this reconnect scenario
	it("keeps a loaded thread through a changed reconnect listing and live updates", async () => {
		const newer = {
			...whole,
			messages: [
				...whole.messages,
				message("user", "New question"),
				message("agent", "New answer"),
			],
		};
		testing.wholes.c1 = newer;
		const view = await testing.openConversations([whole]);
		const box = view.getByRole("textbox", { name: "Message input" });
		await typeIn(box, "Draft during reconnect");
		testing.talk = { agents: [], conversations: [listed(newer)] };
		await act(async () => testing.talkStream?.onopen?.());
		await waitFor(() =>
			expect(testing.asked).toContain("/api/conversations/c1"),
		);
		expect(view.getByText("Finished reading")).toBeTruthy();
		expect(view.queryByText("Loading conversation")).toBeNull();
		expect(view.queryByText("New answer")).toBeNull();
		await testing.say({
			...newer,
			messages: [...newer.messages, message("agent", "Latest live update")],
		});
		await act(async () => release());
		expect(view.getByText("Latest live update")).toBeTruthy();
		expect(view.getByRole("textbox", { name: "Message input" })).toBe(box);
		expect(box.textContent).toBe("Draft during reconnect");
	});

	it("does not reveal a late response after navigating to another conversation", async () => {
		const first = conversation({
			title: "First",
			messages: [message("agent", "Late first answer")],
		});
		const second = conversation({
			id: "c2",
			title: "Second",
			messages: [message("agent", "Second answer")],
		});
		testing.wholes.c1 = first;
		const view = await testing.openConversations([listed(first), second]);
		await openRow(view, "Second");
		await act(async () => release());
		const thread = within(view.getByRole("region", { name: "Second" }));
		expect(thread.getByText("Second answer")).toBeTruthy();
		expect(view.queryByText("Late first answer")).toBeNull();
		await openRow(view, "First");
		expect(view.getByText("Late first answer")).toBeTruthy();
		expect(view.queryByText("Loading conversation")).toBeNull();
	});

	it("waits for complete history before focusing a waiting question opened by the shortcut", async () => {
		whole = conversation({
			title: "Needs an answer",
			messages: [
				message("user", "Choose a color"),
				message("agent", "1. Which color?\n   - (a) Blue\n   - (b) Green"),
			],
		});
		testing.wholes.c1 = whole;
		const view = await testing.openConversations([listed(whole)], null);
		await act(async () =>
			fireEvent.keyDown(document.body, {
				altKey: true,
				metaKey: true,
				code: "KeyM",
			}),
		);
		expect(view.getByText("Loading conversation")).toBeTruthy();
		expect(view.queryByRole("listitem", { name: "question 1" })).toBeNull();
		await act(async () => release());
		const card = await waitFor(() =>
			view.getByRole("listitem", { name: "question 1" }),
		);
		await waitFor(() =>
			expect(card.contains(document.activeElement)).toBe(true),
		);
	});
});
