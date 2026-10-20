import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	cleanup,
	conversation,
	fireEvent,
	message,
	Testing,
	waitFor,
	within,
} from "./testing";

describe("App's thread history window", () => {
	let testing: Testing;
	let messages: ReturnType<typeof message>[];
	beforeEach(() => {
		testing = new Testing();
		messages = Array.from({ length: 45 }, (_, i) => [
			message("user", `Question number ${i}`),
			message("agent", `Answer number ${i}`),
		]).flat();
	});
	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("opens long threads at recent turns and loads earlier history on demand", async () => {
		const view = await testing.openConversations(
			[conversation({ id: "long", title: "Long conversation", messages })],
			"long",
		);
		const thread = view.getByRole("region", { name: "Long conversation" });
		await waitFor(() =>
			expect(within(thread).queryByText("Question number 44")).not.toBeNull(),
		);
		expect(thread.querySelectorAll('[data-slot="aui_turn"]').length).toBe(20);
		expect(within(thread).queryByText("Question number 0")).toBeNull();
		await act(async () =>
			fireEvent.click(
				within(thread).getByRole("button", { name: "Load earlier messages" }),
			),
		);
		await waitFor(() =>
			expect(thread.querySelectorAll('[data-slot="aui_turn"]').length).toBe(40),
		);
		expect(within(thread).queryByText("Question number 5")).not.toBeNull();
		await act(async () =>
			fireEvent.click(
				within(thread).getByRole("button", { name: "Load earlier messages" }),
			),
		);
		await waitFor(() =>
			expect(thread.querySelectorAll('[data-slot="aui_turn"]').length).toBe(45),
		);
		expect(
			within(thread).queryByRole("button", { name: "Load earlier messages" }),
		).toBeNull();
	});

	it("includes an older unread reply and its whole turn when opening", async () => {
		const view = await testing.openConversations(
			[
				conversation({
					id: "unread",
					title: "Unread history",
					messages,
					unread: true,
					seen: 21,
				}),
			],
			"unread",
		);
		const thread = view.getByRole("region", { name: "Unread history" });
		await waitFor(() =>
			expect(within(thread).queryByText("Answer number 10")).not.toBeNull(),
		);
		expect(within(thread).queryByText("Question number 10")).not.toBeNull();
		expect(within(thread).queryByText("Question number 9")).toBeNull();
		expect(thread.querySelectorAll('[data-slot="aui_turn"]').length).toBe(35);
	});
});
