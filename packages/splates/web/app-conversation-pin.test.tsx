import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	cleanup,
	conversation,
	fireEvent,
	Testing,
	within,
} from "./testing";

describe("App's pinning conversations", () => {
	let testing: Testing;
	let nav: HTMLElement;

	beforeEach(async () => {
		testing = new Testing();
		const view = await testing.openConversations(
			[
				conversation({
					id: "c1",
					title: "Old",
					pinned: true,
					createdAt: "2026-10-11T10:01:00.000Z",
				}),
				conversation({
					id: "c2",
					title: "New",
					createdAt: "2026-10-11T10:02:00.000Z",
				}),
			],
			null,
			{ tasks: [] },
		);
		nav = view.getByRole("navigation", { name: "conversations" });
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("lists pinned conversations first, each marked pinned", () => {
		const items = within(nav).getAllByRole("listitem");

		expect(items.map((item) => item.textContent)).toEqual(["Old", "New"]);
		expect(
			items.map((item) => within(item).queryByLabelText("Pinned") !== null),
		).toEqual([true, false]);
	});

	it("offers Pin then Archive after the menu", () => {
		const row = within(nav).getAllByRole("listitem")[1] as HTMLElement;

		expect(
			within(row)
				.getAllByRole("button")
				.slice(1)
				.map((button) => button.getAttribute("aria-label")),
		).toEqual(["More for New", "Pin New", "Archive New"]);
	});

	it("pins and unpins", async () => {
		await act(async () =>
			fireEvent.click(within(nav).getByRole("button", { name: "Pin New" })),
		);
		await act(async () =>
			fireEvent.click(within(nav).getByRole("button", { name: "Unpin Old" })),
		);

		expect([
			testing.posted("/api/conversations/c2/pinned"),
			testing.posted("/api/conversations/c1/pinned"),
		]).toEqual([
			[{ method: "PUT", body: { pinned: true } }],
			[{ method: "PUT", body: { pinned: false } }],
		]);
	});
});
