import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	type ConversationsView,
	cleanup,
	conversation,
	fireEvent,
	message,
	Testing,
	waitFor,
	within,
} from "./testing";

describe("App's question cards when arbor tells the agent of a task's end", () => {
	let testing: Testing;
	let view: ConversationsView;

	const report = [
		"## ⚠️ Escalated header: waiting on two calls",
		"",
		"1. Which pages need it?",
		"   - [a] Todos",
		"   - [b] Tasks",
		"2. How should a stale todo be shown?",
		"   - (a) A muted card",
		"   - (b) A badge",
	].join("\n");

	const asked = [message("user", "fix the header"), message("agent", report)];

	const told = (...more: ReturnType<typeof message>[]) =>
		conversation({
			title: "Header",
			messages: [...asked, message("user", "[ARBOR REPORT footer]"), ...more],
		});

	// The latest card's second question, as a message can ask it again.
	const second = () =>
		view.getAllByRole("listitem", { name: "question 2" }).at(-1) as HTMLElement;

	beforeEach(async () => {
		testing = new Testing();
		view = await testing.openConversations([
			conversation({ title: "Header", messages: asked }),
		]);
		await waitFor(second);
		await act(async () =>
			fireEvent.click(
				within(second()).getByRole("button", { name: /A badge/ }),
			),
		);
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("keeps its questions open, and what was written in them", async () => {
		await act(async () => testing.say(told()));

		expect(
			within(second())
				.getAllByRole("button", { pressed: true })
				.map((each) => each.textContent),
		).toEqual(["bA badge"]);
		expect(view.getByText("1 of 2 answered")).toBeTruthy();
		expect(
			(view.getByRole("button", { name: "Send" }) as HTMLButtonElement)
				.disabled,
		).toBe(false);
	});

	it("answers them where the agent asks them again, with what was written", async () => {
		await act(async () => testing.say(told(message("agent", report))));

		await waitFor(() =>
			expect(view.getAllByRole("button", { name: "Send" })).toHaveLength(1),
		);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Send" })),
		);
		expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
			{
				method: "POST",
				body: {
					text: "> **How should a stale todo be shown?**\n\n- (b) A badge",
				},
			},
		]);
	});
});
