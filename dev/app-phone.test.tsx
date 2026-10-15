import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	cleanup,
	conversation,
	details,
	fireEvent,
	message,
	resize,
	Testing,
	waitFor,
	within,
} from "./testing";

describe("App on a phone", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
		resize(390, 844);
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
		resize(1024, 768);
	});

	const report = [
		"## ⚠️ Escalated header: waiting on two calls",
		"",
		"The header wraps now.",
		"",
		"1. Which pages need it?",
		"   - [a] Todos",
		"   - [b] Tasks",
		"2. How should a stale todo be shown?",
		"   - (a) A muted card",
		"   - (b) A badge",
		"3. Ready to merge?",
	].join("\n");

	it("lists the agents waiting on you first in its inbox", async () => {
		const view = await testing.openConversations(
			[
				conversation({ id: "c1", title: "Quiet", status: "stopped" }),
				conversation({ id: "c2", title: "Broke", status: "failed" }),
			],
			null,
			// No external agents, which would list as working.
			{ tasks: [] },
		);

		const inbox = view.getByRole("region", { name: "inbox" });
		expect(
			within(inbox)
				.getAllByRole("region")
				.map((group) => group.getAttribute("aria-label")),
		).toEqual(["Needs you", "Recent"]);
		const waiting = within(inbox).getByRole("region", { name: "Needs you" });
		expect(waiting.textContent).toContain("Broke");
		expect(waiting.textContent).toContain("Failed");
	});

	it("nests a subagent under the agent it reports to, which is answered for it", async () => {
		const view = await testing.openConversations(
			[conversation({ id: "orch", title: "Orchestrator", status: "idle" })],
			null,
			{
				tasks: [
					details({
						task: "sub",
						status: "escalated",
						escalation: "look",
						caller: "orch",
					}),
				],
			},
		);

		const waiting = within(
			view.getByRole("region", { name: "inbox" }),
		).getByRole("region", { name: "Needs you" });
		expect(within(waiting).getByRole("heading").textContent).toBe(
			"Needs you · 1",
		);
		const [orchestrator, sub] = within(waiting).getAllByRole("button");
		expect(orchestrator?.textContent).toContain("Escalated · sub: look");
		expect(sub?.textContent).toContain("sub");

		await act(async () => fireEvent.click(sub as HTMLElement));
		const note = view.getByRole("note", { name: "reports to" });
		expect(view.queryByText("Its agent runs outside the page")).toBeNull();
		await act(async () =>
			fireEvent.click(
				within(note).getByRole("button", { name: "Open Orchestrator" }),
			),
		);

		expect(location.hash).toBe("#conversations/orch");
	});

	it("starts a new conversation from the composer along the inbox's bottom", async () => {
		const view = await testing.openConversations([], null);

		await act(async () =>
			fireEvent.focus(
				view.getByRole("textbox", { name: "Start a conversation" }),
			),
		);

		expect(location.hash).toBe("#conversations/new");
		expect(view.getByRole("region", { name: "new conversation" })).toBeTruthy();
	});

	it("answers questions one at a time, in a sheet the bar above the composer opens", async () => {
		const view = await testing.openConversations([
			conversation({
				title: "Header",
				messages: [message("user", "fix the header"), message("agent", report)],
			}),
		]);

		// In the thread, a line in place of the card.
		expect(view.queryByRole("list", { name: "questions" })).toBeNull();
		const bar = await waitFor(() =>
			view.getByRole("button", { name: /3 questions for you\s*Answer/ }),
		);
		await act(async () => fireEvent.click(bar));
		const sheet = await waitFor(() =>
			view.getByRole("dialog", { name: "3 questions for you" }),
		);
		const shown = () =>
			within(sheet)
				.getAllByRole("listitem")
				.map((card) => card.getAttribute("aria-label"));
		expect(shown()).toEqual(["question 1"]);
		// Pinned under every question: what else to say, and Send.
		expect(
			within(sheet).getByRole("textbox", { name: "Anything else" }),
		).toBeTruthy();
		expect(within(sheet).getByRole("button", { name: "Send" })).toBeTruthy();
		// Its progress in the dots of its footer, not wrapping the header.
		expect(sheet.textContent).not.toContain("answered");
		const nav = within(sheet).getByRole("navigation", { name: "questions" });
		expect(
			within(nav)
				.getByRole("button", { current: "step" })
				.getAttribute("aria-label"),
		).toBe("Question 1 of 3");

		// Picking all that apply leaves it to the arrow to go on.
		await act(async () =>
			fireEvent.click(within(sheet).getByRole("button", { name: /Todos/ })),
		);
		expect(shown()).toEqual(["question 1"]);
		await act(async () =>
			fireEvent.click(
				within(sheet).getByRole("button", { name: "Next question" }),
			),
		);
		expect(shown()).toEqual(["question 2"]);

		// Picking one goes on by itself.
		await act(async () =>
			fireEvent.click(
				within(sheet).getByRole("button", { name: /A muted card/ }),
			),
		);
		await waitFor(() => expect(shown()).toEqual(["question 3"]));

		await act(async () =>
			fireEvent.click(
				within(sheet).getByRole("button", { name: "Previous question" }),
			),
		);
		expect(shown()).toEqual(["question 2"]);
		await act(async () =>
			fireEvent.click(
				within(nav).getByRole("button", { name: "Question 1 of 3, answered" }),
			),
		);
		expect(shown()).toEqual(["question 1"]);
	});

	it("leaves the dots off a sheet of one question", async () => {
		const view = await testing.openConversations([
			conversation({
				title: "Header",
				messages: [
					message("user", "fix the header"),
					message("agent", "1. Which pages need it?\n   - [a] Todos"),
				],
			}),
		]);

		await act(async () =>
			fireEvent.click(
				await waitFor(() =>
					view.getByRole("button", { name: /1 question for you\s*Answer/ }),
				),
			),
		);
		const sheet = await waitFor(() =>
			view.getByRole("dialog", { name: "1 question for you" }),
		);
		expect(within(sheet).queryByRole("navigation")).toBeNull();
		expect(sheet.textContent).not.toContain("answered");
		expect(within(sheet).getByRole("button", { name: "Send" })).toBeTruthy();
	});

	it("goes from a sheet the inbox opened to the conversation behind it", async () => {
		const view = await testing.openConversations(
			[
				conversation({
					id: "c1",
					title: "Header",
					task: "alpha",
					messages: [
						message("user", "fix the header"),
						message("agent", report),
					],
				}),
			],
			null,
			{ tasks: [details({ task: "alpha", status: "escalated" })] },
		);

		await act(async () =>
			fireEvent.click(
				within(view.getByRole("region", { name: "Needs you" })).getByRole(
					"button",
					{ name: /alpha/ },
				),
			),
		);
		const sheet = await waitFor(() =>
			view.getByRole("dialog", { name: "3 questions for you" }),
		);
		await act(async () =>
			fireEvent.click(
				within(sheet).getByRole("button", { name: "Conversation" }),
			),
		);

		await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
		expect(location.hash).toBe("#conversations/c1");
		expect(view.getByText("fix the header")).toBeTruthy();
	});

	it("goes on from its header to the next agent waiting on you", async () => {
		const view = await testing.openConversations([
			conversation({ id: "c1", title: "Broke", status: "failed" }),
			conversation({ id: "c2", title: "Also broke", status: "failed" }),
		]);
		expect(location.hash).toBe("#conversations/c1");

		await act(async () =>
			fireEvent.click(
				view.getByRole("button", { name: "Next waiting on you, of 1" }),
			),
		);

		expect(location.hash).toBe("#conversations/c2");
	});
});
