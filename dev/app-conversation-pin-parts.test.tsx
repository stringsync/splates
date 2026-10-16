import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { cleanup, conversation, details, Testing, within } from "./testing";

describe("App's pinning a part's conversation", () => {
	let testing: Testing;
	let view: Awaited<ReturnType<Testing["openConversations"]>>;

	beforeEach(async () => {
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
		cleanup();
		testing.dispose();
	});

	it("offers a pin for the host", () => {
		expect(view.getByRole("button", { name: "Pin alpha" })).toBeTruthy();
	});

	it("offers none for a part nested under it, pinned or not", () => {
		const parts = view.getByRole("list", { name: "parts of alpha" });

		expect(
			within(parts)
				.getAllByRole("button")
				.map((button) => button.getAttribute("aria-label") ?? "")
				.filter((label) => /^(Pin|Unpin) /.test(label)),
		).toEqual([]);
		expect(within(parts).queryByLabelText("Pinned")).toBeNull();
	});
});
