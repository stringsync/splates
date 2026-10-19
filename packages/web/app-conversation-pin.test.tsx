import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	agentList,
	type ConversationsView,
	cleanup,
	conversation,
	fireEvent,
	resize,
	Testing,
	within,
} from "./testing";

describe("App's pinning conversations", () => {
	let testing: Testing;
	let view: ConversationsView;
	let inbox: HTMLElement;

	beforeEach(async () => {
		// Rows act from the inbox, which only a phone has.
		resize(390, 844);
		testing = new Testing();
		view = await testing.openConversations(
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
				conversation({
					id: "c3",
					title: "Runs",
					status: "running",
					createdAt: "2026-10-11T10:03:00.000Z",
				}),
			],
			null,
			{ tasks: [] },
		);
		inbox = agentList(view);
	});

	afterEach(() => {
		resize(1024, 768);
		cleanup();
		testing.dispose();
	});

	/** Opens the menu of `name`'s inbox row, as a right-click does. */
	async function menu(name: string) {
		const row = within(inbox).getByText(name).closest("button") as Element;
		await act(async () => {
			fireEvent.pointerDown(row);
			fireEvent.contextMenu(row);
		});
		return view.getByRole("dialog", { name });
	}

	it("lists pinned conversations first, above those at work", () => {
		expect(
			within(inbox)
				.getAllByRole("listitem")
				.map((item) =>
					["Old", "New", "Runs"].find((name) => within(item).queryByText(name)),
				),
		).toEqual(["Old", "Runs", "New"]);
	});

	it("offers Pin then Archive at the end of the menu", async () => {
		const sheet = await menu("New");

		expect(
			within(sheet)
				.getAllByRole("button")
				.map((button) => button.textContent),
		).toEqual([
			"Rename",
			"Mark as unread",
			"Move under…",
			"Pin",
			"Archive",
			"Cancel",
		]);
	});

	it("pins and unpins", async () => {
		const pick = async (name: string, action: string) =>
			fireEvent.click(
				within(await menu(name)).getByRole("button", { name: action }),
			);
		await act(async () => pick("New", "Pin"));
		await act(async () => pick("Old", "Unpin"));

		expect([
			testing.posted("/api/conversations/c2/pinned"),
			testing.posted("/api/conversations/c1/pinned"),
		]).toEqual([
			[{ method: "PUT", body: { pinned: true } }],
			[{ method: "PUT", body: { pinned: false } }],
		]);
	});
});
