import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	cleanup,
	conversation,
	fireEvent,
	resize,
	Testing,
	waitFor,
} from "./testing";

describe("Conversation viewport scrolling", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
		resize(1024, 768);
	});

	it("disables outer panel scrolling on full-viewport workspaces and keeps it on document pages", async () => {
		const view = await testing.openConversations([
			conversation({ id: "c1", title: "Fix scroll" }),
		]);

		const panel = view.container.querySelector("[data-desktop-panel]");
		expect(panel).not.toBeNull();
		expect(panel?.className).toContain("overflow-hidden");
		expect(panel?.className).not.toContain("overflow-y-auto");

		const viewport = view.container.querySelector(
			'[data-slot="aui_thread-viewport"]',
		);
		expect(viewport).not.toBeNull();
		expect(viewport?.className).toContain("overflow-y-scroll");

		// Switching to a document page restores outer panel scrolling.
		await act(async () => {
			fireEvent.click(view.getByRole("tab", { name: "Boards" }));
		});
		await waitFor(() => {
			expect(panel?.className).toContain("overflow-y-auto");
			expect(panel?.className).not.toContain("overflow-hidden");
		});
	});

	it("keeps an unbroken flex-column height chain to the thread viewport on a phone", async () => {
		resize(390, 844);
		const view = await testing.openConversations([
			conversation({ id: "c1", title: "Fix mobile scroll" }),
		]);

		const viewport = view.container.querySelector(
			'[data-slot="aui_thread-viewport"]',
		);
		expect(viewport).not.toBeNull();
		expect(viewport?.className).toContain("overflow-y-scroll");

		// Walk up from the conversation wrapper to the fixed phone Screen and
		// verify every ancestor between them propagates the constrained height.
		const conversationRoot = viewport?.closest(
			".\\[view-transition-name\\:conversation\\]",
		);
		expect(conversationRoot).not.toBeNull();
		const phonePage = conversationRoot?.parentElement;
		expect(phonePage).not.toBeNull();
		expect(phonePage?.className).toContain("flex");
		expect(phonePage?.className).toContain("flex-col");
		expect(phonePage?.className).toContain("min-h-0");
		expect(phonePage?.className).toContain("flex-1");

		const screen = phonePage?.parentElement;
		expect(screen).not.toBeNull();
		expect(screen?.className).toContain("fixed");
		expect(screen?.className).toContain("flex-col");
		expect(screen?.className).toContain("overflow-hidden");
	});
});
