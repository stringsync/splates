import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	cleanup,
	conversation,
	details,
	fireEvent,
	newestFirst,
	Testing,
	todo,
	waitFor,
	within,
} from "./testing";

describe("App's conversation list by lane", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	const open = () =>
		testing.openConversations(
			newestFirst([
				conversation({ id: "c1", task: "upload-retry", title: "Retry" }),
				conversation({ id: "c2", task: null, title: "Look around" }),
				conversation({ id: "c3", task: "upload-size", title: "Size" }),
			]),
			null,
			{
				tasks: [
					details({ task: "upload-retry", lease: "held" }),
					details({ task: "upload-size", lease: "held" }),
				],
				todos: [
					todo({ id: 1, lane: 3, takenBy: "upload-retry" }),
					todo({ id: 2, lane: 3, takenBy: "upload-size" }),
				],
				lanes: [{ id: 3, name: "Uploads" }],
				laneNames: [{ id: 3, name: "Uploads" }],
			},
		);

	it("gathers the conversations at work on one lane under its title, where the newest of them was", async () => {
		const view = await open();
		const nav = view.getByRole("navigation", { name: "conversations" });
		const list = within(nav).getByRole("list", { name: "conversation list" });

		expect(
			[...list.children].map(
				(item) =>
					(
						item.querySelector("button[title$='on the board']") ??
						item.querySelector("button")
					)?.textContent,
			),
		).toEqual(["Uploads", "Look around"]);
		expect(
			within(within(list).getByRole("list", { name: "Uploads lane" }))
				.getAllByRole("listitem")
				.map((item) => item.textContent),
		).toEqual(["upload-retry", "upload-size"]);
	});

	it("opens the board on the lane from its title", async () => {
		const view = await open();

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Uploads" })),
		);

		expect(location.hash).toBe("#lanes/3");
		await waitFor(() =>
			expect(
				view.getByRole("region", { name: "Uploads" }).getAttribute("data-lane"),
			).toBe("3"),
		);
	});

	it("folds a lane's conversations away and back from its chevron", async () => {
		const view = await open();

		await act(async () =>
			fireEvent.click(
				view.getByRole("button", { name: "Collapse Uploads lane" }),
			),
		);
		expect(view.queryByRole("list", { name: "Uploads lane" })).toBeNull();

		await act(async () =>
			fireEvent.click(
				view.getByRole("button", { name: "Expand Uploads lane" }),
			),
		);
		expect(view.getByRole("list", { name: "Uploads lane" })).toBeTruthy();
	});
});
