import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Duration } from "webappwiz/time";
import {
	act,
	cleanup,
	conversation,
	fireEvent,
	message,
	Testing,
	typeIn,
	waitFor,
	within,
} from "./testing";

describe("App's messages still sending", () => {
	let testing: Testing;
	let view: Awaited<ReturnType<Testing["openConversations"]>>;

	beforeEach(async () => {
		testing = new Testing();
		view = await testing.openConversations([
			conversation({
				title: "Login",
				status: "running",
				taking: "queue",
				messages: [message("user", "go")],
			}),
		]);
		// Unanswered, so what is said stays on its way.
		testing.holdWrites();
		const box = view.getByRole("textbox", { name: "Message input" });
		await typeIn(box, "and the logout");
		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("says a message is still sending once it goes unanswered for a few seconds", async () => {
		const queued = view.getByRole("region", { name: "queued messages" });
		expect(within(queued).queryByText("Sending…")).toBeNull();

		await act(async () => {
			testing.wall.advance(Duration.secs(4));
			testing.timer.fireTimeouts();
		});

		expect(within(queued).getByText("Sending…")).toBeTruthy();
	});

	it("shows the server's copy at once when the prompt's answer holds the message's id", async () => {
		await act(async () => {
			testing.wall.advance(Duration.secs(4));
			testing.timer.fireTimeouts();
		});
		testing.reply = conversation({
			title: "Login",
			status: "running",
			taking: "queue",
			messages: [
				message("user", "go"),
				{
					...message("user", "and the logout"),
					queued: true,
					id: testing.sentId("c1", "and the logout"),
				},
			],
		});

		await act(async () => testing.release());

		const queued = view.getByRole("region", { name: "queued messages" });
		await waitFor(() =>
			expect(within(queued).queryByText("Sending…")).toBeNull(),
		);
		expect(within(queued).getAllByText("and the logout")).toHaveLength(1);
	});

	it("gives up on a message the live stream reconnects without, with Retry", async () => {
		// Opened once as the page loaded, then again after a drop.
		await act(async () => testing.talkStream?.onopen?.());
		await act(async () => testing.talkStream?.onopen?.());

		const thread = view.getByRole("region", { name: "Login" });
		await waitFor(() =>
			expect(within(thread).getByText("Couldn't send")).toBeTruthy(),
		);
		expect(within(thread).getByRole("button", { name: "Retry" })).toBeTruthy();
		expect(view.queryByRole("region", { name: "queued messages" })).toBeNull();
	});
});
