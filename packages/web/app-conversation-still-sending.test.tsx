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

	it("says a message is sending after a moment, and when it times out once unanswered for a few seconds", async () => {
		const thread = view.getByRole("region", { name: "Login" });
		// Not at once, so a quick answer shows nothing.
		expect(within(thread).queryByText(/Sending…/)).toBeNull();
		expect(await within(thread).findByText("Sending…")).toBeTruthy();

		await act(async () => {
			testing.wall.advance(Duration.secs(4));
			testing.timer.fireTimeout(
				testing.timer.timeouts.findIndex(
					(each) => !each.disposed && each.delay.ms === Duration.secs(3).ms,
				),
			);
		});

		expect(within(thread).getByText("Sending… times out in 26s")).toBeTruthy();
	});

	it("counts down each second and offers Retry and Edit when the deadline passes", async () => {
		const thread = view.getByRole("region", { name: "Login" });
		await act(async () => {
			testing.wall.advance(Duration.secs(3));
			testing.timer.fireTimeout(
				testing.timer.timeouts.findIndex(
					(each) => !each.disposed && each.delay.ms === Duration.secs(3).ms,
				),
			);
		});
		expect(within(thread).getByText("Sending… times out in 27s")).toBeTruthy();
		await act(async () => {
			testing.wall.advance(Duration.secs(1));
			testing.timer.fireTimeout(
				testing.timer.timeouts.findIndex(
					(each) => !each.disposed && each.delay.ms === Duration.secs(1).ms,
				),
			);
		});
		expect(within(thread).getByText("Sending… times out in 26s")).toBeTruthy();
		await act(async () => {
			testing.wall.advance(Duration.secs(26));
			testing.timer.fireTimeouts();
		});
		expect(view.queryByText(/Sending…/)).toBeNull();
		expect(view.getByText("Couldn't send").title).toBe("Sending timed out");
		expect(view.getByRole("button", { name: "Retry" })).toBeTruthy();
		expect(view.getByRole("button", { name: "Edit" })).toBeTruthy();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Retry" })),
		);
		expect(view.queryByText("Couldn't send")).toBeNull();
		await act(async () => {
			testing.wall.advance(Duration.secs(3));
			testing.timer.fireTimeout(
				testing.timer.timeouts.findIndex(
					(each) => !each.disposed && each.delay.ms === Duration.secs(3).ms,
				),
			);
		});
		expect(view.getByText("Sending… times out in 27s")).toBeTruthy();
	});

	it("shows the server's copy at once when the prompt's answer holds the message's id", async () => {
		await act(async () => {
			testing.wall.advance(Duration.secs(4));
			testing.timer.fireTimeout(
				testing.timer.timeouts.findIndex(
					(each) => !each.disposed && each.delay.ms === Duration.secs(3).ms,
				),
			);
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

		const thread = view.getByRole("region", { name: "Login" });
		await waitFor(() =>
			expect(within(thread).queryByText(/Sending…/)).toBeNull(),
		);
		expect(within(thread).getAllByText("and the logout")).toHaveLength(1);
		await act(async () => {
			testing.wall.advance(Duration.secs(30));
			testing.timer.fireTimeouts();
		});
		expect(view.queryByText("Couldn't send")).toBeNull();
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
	});
});
