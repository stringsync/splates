import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	agentList,
	type ConversationsView,
	cleanup,
	conversation,
	details,
	fireEvent,
	resize,
	Testing,
	within,
} from "./testing";

describe("App's pinning a part's conversation", () => {
	let testing: Testing;
	let view: ConversationsView;

	beforeEach(async () => {
		// Rows act from the inbox, which only a phone has.
		resize(390, 844);
		testing = new Testing();
		view = await testing.openConversations(
			[
				conversation({ id: "c1", task: "alpha" }),
				conversation({ id: "c2", task: "alpha-api" }),
				conversation({ id: "c3", task: "alpha-ui", pinned: true }),
			],
			null,
			{
				tasks: [
					details({ task: "alpha" }),
					details({ task: "alpha-api", base: "task/alpha" }),
					details({ task: "alpha-ui", base: "task/alpha" }),
				],
			},
		);
	});

	afterEach(() => {
		resize(1024, 768);
		cleanup();
		testing.dispose();
	});

	/** What the menu of `name`'s inbox row offers, as a right-click opens it. */
	async function offered(name: string): Promise<(string | null)[]> {
		const inbox = agentList(view);
		const row = within(inbox)
			.getAllByText(name)[0]
			?.closest("button") as Element;
		await act(async () => {
			fireEvent.pointerDown(row);
			fireEvent.contextMenu(row);
		});
		const sheet = within(view.getByRole("dialog", { name }));
		const labels = sheet
			.getAllByRole("button")
			.map((button) => button.textContent);
		await act(async () =>
			fireEvent.click(sheet.getByRole("button", { name: "Cancel" })),
		);
		return labels;
	}

	it("offers a pin for the host", async () => {
		expect(await offered("alpha")).toContain("Pin");
	});

	it("offers none for a part nested under it, pinned or not", async () => {
		const parts = [await offered("alpha-api"), await offered("alpha-ui")];

		expect(
			parts.map((each) =>
				each.filter((label) => /^(Pin|Unpin)$/.test(label ?? "")),
			),
		).toEqual([[], []]);
	});
});
