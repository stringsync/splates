import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	cleanup,
	conversation,
	fireEvent,
	menuItem,
	message,
	newWith,
	resize,
	Testing,
	typeIn,
	waitFor,
	within,
} from "./testing";

/** A finger for a pointer, as on a phone. */
const COARSE = {
	matches: true,
	addEventListener: () => {},
	removeEventListener: () => {},
} as unknown as MediaQueryList;

describe("App on a touch device", () => {
	const media = window.matchMedia;
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
		// Every other query answers as it did.
		window.matchMedia = (query) =>
			query === "(pointer: coarse)" ? COARSE : media.call(window, query);
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
		window.matchMedia = media;
	});

	it("shows no keyboard shortcuts, beside an action or in Settings", async () => {
		const view = await testing.openConversations([
			conversation({ id: "c1", task: "alpha", title: "Fix login" }),
			conversation({ id: "c2", title: "Look around" }),
		]);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Claude Look around" })),
		);
		expect(
			within(view.getByRole("navigation", { name: "actions" }))
				.getAllByRole("button")
				.map((button) => button.textContent),
		).toEqual(["Terminal", "Show timestamps", "Archive"]);

		await act(async () => fireEvent.click(await menuItem(view, "Settings")));
		const dialog = view.getByRole("dialog", { name: "Settings" });
		expect(
			within(
				within(dialog).getByRole("navigation", { name: "setting categories" }),
			)
				.getAllByRole("button")
				.map((each) => each.textContent),
		).toEqual(["Appearance", "Editor", "Notifications", "Restart"]);
	});

	it("leaves the composer for a tap, in a conversation opened or new", async () => {
		const view = await testing.openConversations(
			[conversation({ id: "c1", title: "Latest" })],
			"c1",
		);
		const opened = view.getByRole("textbox", { name: "Message input" });
		// Not the element, whose printout on a failure overwhelms Bun.
		expect(document.activeElement === opened).toBe(false);

		await newWith(view, "Codex");
		const started = within(
			view.getByRole("region", { name: "new conversation" }),
		).getByRole("textbox", { name: "Message input" });
		expect(document.activeElement === started).toBe(false);
	});

	it("opens a review in its sheet on a phone without raising the keyboard", async () => {
		resize(390, 844);
		try {
			const view = await testing.openConversations([
				conversation({
					title: "Header",
					messages: [
						message(
							"agent",
							[
								"## 🔍 Ready to merge header onto main",
								"",
								"The header wraps on phones.",
								"",
								'Reply "merge", or say what to change.',
							].join("\n"),
						),
					],
				}),
			]);

			await act(async () =>
				fireEvent.click(
					await waitFor(() =>
						view.getByRole("button", { name: /Ready to merge\s*Answer/ }),
					),
				),
			);

			const sheet = await waitFor(() =>
				view.getByRole("dialog", { name: "Ready to merge" }),
			);
			expect(within(sheet).getByRole("textbox")).toBeTruthy();
			expect(document.activeElement?.tagName).not.toBe("TEXTAREA");
		} finally {
			resize(1024, 768);
		}
	});

	it("keeps the keyboard up for a message being typed as the agent starts", async () => {
		const view = await testing.openConversations(
			[conversation({ id: "c1", title: "Latest" })],
			"c1",
		);
		const box = view.getByRole("textbox", { name: "Message input" });
		await typeIn(box, "and then");

		await testing.say(conversation({ id: "c1", status: "running" }));
		await act(async () => {});
		expect(document.activeElement === box).toBe(true);
	});

	it("drops the keyboard once a message is sent", async () => {
		const view = await testing.openConversations([conversation()]);
		const box = view.getByRole("textbox", { name: "Message input" });
		await typeIn(box, "hello");
		expect(document.activeElement === box).toBe(true);

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Send message" })),
		);
		expect(testing.posted("/api/conversations/c1/prompt")).toHaveLength(1);
		expect(box.contains(document.activeElement)).toBe(false);
	});

	it("types a new line on Return, sending only on Send", async () => {
		const view = await testing.openConversations([conversation()]);
		const box = view.getByRole("textbox", { name: "Message input" });

		await typeIn(box, "hello");
		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));
		expect(testing.posted("/api/conversations/c1/prompt")).toEqual([]);

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Send message" })),
		);
		expect(testing.posted("/api/conversations/c1/prompt")).toHaveLength(1);
	});

	it("sends nothing queued on Return with nothing typed", async () => {
		const view = await testing.openConversations(
			[
				conversation({
					id: "c1",
					status: "running",
					messages: [
						message("user", "go"),
						{ ...message("user", "the second note"), queued: true },
					],
				}),
			],
			"c1",
		);
		const box = view.getByRole("textbox", { name: "Message input" });

		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));
		expect(testing.posted("/api/conversations/c1/send-now")).toEqual([]);
	});
});
