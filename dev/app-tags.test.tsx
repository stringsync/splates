import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { act, cleanup, fireEvent, Testing, todo, within } from "./testing";

describe("App's tags", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("filters the list by a tag from the row above it, or from a card", async () => {
		const view = await testing.open({
			todos: [
				todo({ id: 1, subject: "page bug", tags: ["page"] }),
				todo({ id: 2, subject: "merge flake", position: 2, tags: ["merge"] }),
				todo({ id: 3, subject: "merge race", position: 3, tags: ["merge"] }),
			],
		});
		const filter = view.getByRole("group", { name: "filter by tag" });
		const list = view.getByRole("list", { name: "todos" });

		expect(view.queryByRole("progressbar")).toBeNull();
		await act(async () =>
			fireEvent.click(within(filter).getByRole("button", { name: "page 1" })),
		);
		expect(within(list).queryByText("merge flake")).toBeNull();
		expect(within(list).getByText("page bug")).toBeTruthy();

		await act(async () =>
			fireEvent.click(within(filter).getByRole("button", { name: "All 3" })),
		);
		expect(within(list).getByText("merge flake")).toBeTruthy();

		await act(async () =>
			fireEvent.click(
				within(list).getAllByRole("button", {
					name: "show only merge",
				})[0] as HTMLElement,
			),
		);
		expect(within(list).queryByText("page bug")).toBeNull();
		expect(
			within(filter)
				.getByRole("button", { name: "merge 2" })
				.getAttribute("aria-pressed"),
		).toBe("true");
	});
});
