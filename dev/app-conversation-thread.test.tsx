import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	cleanup,
	conversation,
	fireEvent,
	message,
	Testing,
	tool,
	waitFor,
	within,
} from "./testing";

describe("App's conversation thread", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("shows what was said as the server streams it", async () => {
		const view = await testing.openConversations([
			conversation({ title: "Read the note" }),
		]);

		await testing.say(
			conversation({
				title: "Read the note",
				status: "running",
				messages: [
					message("user", "what does it say?"),
					message(
						"agent",
						tool({ command: "cat note.txt", status: "in_progress" }),
						"It says **hi**.",
					),
				],
			}),
		);

		const thread = view.getByRole("region", { name: "Read the note" });
		await waitFor(() =>
			expect(thread.textContent).toContain("what does it say?"),
		);
		await waitFor(() =>
			expect(within(thread).getByText("hi").tagName).toBe("STRONG"),
		);
		expect(thread.textContent).toContain("Working");
	});

	it("stamps each message with how long ago it was said once the actions turn timestamps on, and a settled reply with when it ended", async () => {
		const minutes = (ago: number) =>
			new Date(Date.now() - ago * 60_000).toISOString();
		const view = await testing.openConversations(
			[
				conversation({
					id: "c1",
					title: "Read the note",
					messages: [
						{ ...message("user", "what does it say?"), at: minutes(9) },
						{
							...message("agent", "It says hi."),
							at: minutes(8),
							until: minutes(4),
						},
					],
				}),
			],
			"c1",
		);
		const thread = view.getByRole("region", { name: "Read the note" });
		const stamps = () =>
			[...thread.querySelectorAll("time")].map((each) => each.textContent);
		await waitFor(() =>
			expect(thread.textContent).toContain("what does it say?"),
		);
		expect(stamps()).toEqual([]);

		const actions = view.getByRole("navigation", { name: "actions" });
		await act(async () =>
			fireEvent.click(
				within(actions).getByRole("button", { name: "Show timestamps" }),
			),
		);

		await waitFor(() => expect(stamps()).toEqual(["9m ago", "4m ago"]));
		await act(async () =>
			fireEvent.click(
				within(actions).getByRole("button", { name: "Hide timestamps" }),
			),
		);
		expect(stamps()).toEqual([]);
	});

	it("labels a message another conversation told with a link back to it", async () => {
		const view = await testing.openConversations(
			[
				conversation({ id: "orch", title: "Orchestrate" }),
				conversation({
					id: "c1",
					title: "Read the note",
					handedBy: "orch",
					messages: [
						{ ...message("user", "merge it"), told: "orch" },
						{ ...message("user", "thanks") },
					],
				}),
			],
			"c1",
		);
		const thread = view.getByRole("region", { name: "Read the note" });

		await waitFor(() => expect(thread.textContent).toContain("merge it"));

		const labels = thread.querySelectorAll("[data-slot=aui_user-message-told]");
		expect(labels).toHaveLength(1);
		expect(labels[0]?.textContent).toBe("from Orchestrate");
		expect(labels[0]?.querySelector("a")?.getAttribute("href")).toBe(
			"#conversations/orch",
		);
	});

	it("leaves a reply unstamped while it is still being written", async () => {
		localStorage.setItem(
			"arbor.settings",
			JSON.stringify({ "conversation.timestamps": true }),
		);
		const view = await testing.openConversations([
			conversation({ title: "Read the note" }),
		]);

		await testing.say(
			conversation({
				title: "Read the note",
				status: "running",
				messages: [
					{
						...message("user", "what does it say?"),
						at: new Date().toISOString(),
					},
					{ ...message("agent", "It says"), at: new Date().toISOString() },
				],
			}),
		);

		const thread = view.getByRole("region", { name: "Read the note" });
		await waitFor(() =>
			expect(thread.textContent).toContain("what does it say?"),
		);
		expect(
			[...thread.querySelectorAll("time")].map((each) => each.textContent),
		).toEqual(["just now"]);
	});

	it("shows the work row the agent's work will fill, saying only Working, while it has yet to do anything", async () => {
		const view = await testing.openConversations([
			conversation({ title: "Read the note" }),
		]);

		await testing.say(
			conversation({
				title: "Read the note",
				status: "running",
				messages: [message("user", "what does it say?")],
			}),
		);

		const thread = view.getByRole("region", { name: "Read the note" });
		await waitFor(() =>
			expect(thread.querySelector('[data-slot="work"]')?.textContent).toBe(
				"Working",
			),
		);
		expect(
			thread.querySelector('[data-slot="aui_assistant-message-indicator"]'),
		).toBeNull();
	});

	it("says Working under a reply while its text streams", async () => {
		const view = await testing.openConversations([
			conversation({ title: "Read the note" }),
		]);

		await testing.say(
			conversation({
				title: "Read the note",
				status: "running",
				messages: [
					message("user", "what does it say?"),
					message("agent", "It says"),
				],
			}),
		);

		const thread = view.getByRole("region", { name: "Read the note" });
		await waitFor(() => expect(thread.textContent).toContain("It says"));
		expect(within(thread).getByText("Working").getAttribute("role")).toBe(
			"status",
		);
	});

	it("copies what the person said from a button on their message, which says it copied", async () => {
		const view = await testing.openConversations([
			conversation({ title: "Read the note" }),
		]);
		const copied: string[] = [];
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: { writeText: async (text: string) => void copied.push(text) },
		});

		await testing.say(
			conversation({
				title: "Read the note",
				messages: [
					message("user", "what does it say?"),
					message("agent", "It says hi."),
				],
			}),
		);

		const thread = view.getByRole("region", { name: "Read the note" });
		const copy = await within(thread).findByRole("button", { name: "Copy" });
		await act(async () => fireEvent.click(copy));
		expect(copied).toEqual(["what does it say?"]);
		await waitFor(() => expect(copy.getAttribute("data-copied")).toBe("true"));
	});

	it("opens a link the agent wrote in a new tab, and a footnote in place", async () => {
		const view = await testing.openConversations([
			conversation({ title: "Read the note" }),
		]);

		await testing.say(
			conversation({
				title: "Read the note",
				messages: [
					message("user", "where is it?"),
					message(
						"agent",
						"See [the docs](https://example.com) and [the note](#note).",
					),
				],
			}),
		);

		const thread = view.getByRole("region", { name: "Read the note" });
		const docs = await within(thread).findByRole("link", { name: "the docs" });
		expect(docs.getAttribute("target")).toBe("_blank");
		expect(docs.getAttribute("rel")).toBe("noreferrer noopener");
		const note = within(thread).getByRole("link", { name: "the note" });
		expect(note.getAttribute("target")).toBeNull();
	});

	it("keeps the reply in the place it held before the agent said anything", async () => {
		const view = await testing.openConversations([
			conversation({ title: "Read the note" }),
		]);
		const asked = message("user", "what does it say?");
		await testing.say(
			conversation({
				title: "Read the note",
				status: "running",
				messages: [asked],
			}),
		);
		const thread = view.getByRole("region", { name: "Read the note" });
		const reply = () =>
			thread.querySelector('[data-slot="aui_assistant-message-root"]');
		await waitFor(() => expect(reply()).not.toBeNull());
		const held = reply();

		await testing.say(
			conversation({
				title: "Read the note",
				status: "running",
				messages: [asked, message("agent", "It says hi.")],
			}),
		);

		await waitFor(() => expect(thread.textContent).toContain("It says hi."));
		// The same element, so it neither fades in again nor moves.
		expect(held?.isConnected).toBe(true);
	});

	it("shows the person's message as markdown, each line break as typed", async () => {
		const view = await testing.openConversations([
			conversation({
				title: "Reply",
				messages: [
					message(
						"user",
						"> **How should it land?**\n\nAs one commit:\n\n- squash\n- `merge`\n\nfirst line\nsecond line",
					),
				],
			}),
		]);
		const thread = view.getByRole("region", { name: "Reply" });
		const box = await waitFor(() => {
			const found = thread.querySelector(".aui-user-message-content");
			expect(found?.querySelector("blockquote strong")?.textContent).toBe(
				"How should it land?",
			);
			return found as HTMLElement;
		});
		expect(
			[...box.querySelectorAll("li")].map((item) => item.textContent),
		).toEqual(["squash", "merge"]);
		expect(box.querySelector("li code")?.textContent).toBe("merge");
		const last = [...box.querySelectorAll("p")].at(-1);
		expect(last?.querySelector("br")).not.toBeNull();
		expect(last?.textContent?.split(/\s+/)).toEqual([
			"first",
			"line",
			"second",
			"line",
		]);
	});

	it("scrolls the thread at once, even when asked to glide", async () => {
		const view = await testing.openConversations([
			conversation({ id: "c1", title: "Fix login" }),
		]);
		const thread = view.container.ownerDocument.querySelector(
			'[data-slot="aui_thread-viewport"]',
		) as HTMLElement;

		thread.scrollTo({ top: 40, behavior: "smooth" });

		// A glide would land on a later tick.
		expect(thread.scrollTop).toBe(40);
	});

	it("shows why a conversation failed, and takes a prompt to resume it", async () => {
		const view = await testing.openConversations([
			conversation({ status: "failed", error: "Claude exited with code 1" }),
		]);

		expect(view.getByRole("alert").textContent).toBe(
			"The agent stopped. Send a message to start it again.Claude exited with code 1",
		);
		expect(
			view
				.getByRole("textbox", { name: "Message input" })
				.getAttribute("contenteditable"),
		).toBe("true");
	});

	it("says arbor stopped an agent left idle, and what wakes it", async () => {
		const view = await testing.openConversations([
			conversation({
				status: "stopped",
				stoppedIdle: "2026-10-14T10:00:00.000Z",
			}),
		]);

		expect(
			view.container.ownerDocument.querySelector('[data-slot="idle-banner"]')
				?.textContent,
		).toBe(
			"Stopped after 30 minutes idle. Sending a message starts it again where it left off.",
		);
	});

	it("says nothing of idling for an agent stopped otherwise", async () => {
		const view = await testing.openConversations([
			conversation({ status: "stopped" }),
		]);

		expect(
			view.container.ownerDocument.querySelector('[data-slot="idle-banner"]'),
		).toBeNull();
	});

	it("counts down to an orchestrator's next heartbeat once it is five minutes out", async () => {
		const view = await testing.openConversations([
			conversation({
				heartbeat: new Date(Date.now() + 4 * 60_000 + 30_000).toISOString(),
			}),
		]);

		expect(
			view.container.ownerDocument.querySelector(
				'[data-slot="heartbeat-banner"]',
			)?.textContent,
		).toBe(
			"Heartbeat in 4:30. It checks on its agents then, unless it speaks first.",
		);
	});

	it("shows no heartbeat more than five minutes out", async () => {
		const view = await testing.openConversations([
			conversation({
				heartbeat: new Date(Date.now() + 9 * 60_000).toISOString(),
			}),
		]);

		expect(
			view.container.ownerDocument.querySelector(
				'[data-slot="heartbeat-banner"]',
			),
		).toBeNull();
	});

	it("says a failed turn takes another try, cut to a few lines until tapped", async () => {
		const view = await testing.openConversations([
			conversation({ error: "Internal error" }),
		]);

		const alert = view.getByRole("alert");
		expect(alert.textContent).toContain(
			"The last turn failed. Send a message to try again.",
		);
		const words = within(alert).getByRole("button", { name: "Internal error" });
		expect(words.getAttribute("aria-expanded")).toBe("false");
		await act(async () => fireEvent.click(words));
		expect(words.getAttribute("aria-expanded")).toBe("true");
	});
});
