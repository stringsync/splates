import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	cleanup,
	conversation,
	fireEvent,
	menuItem,
	newWith,
	Testing,
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
		).toEqual(["Terminal", "Archive"]);

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
});
