import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	cleanup,
	conversation,
	details,
	fireEvent,
	newestFirst,
	resize,
	Testing,
	todo,
	waitFor,
	within,
} from "./testing";

describe("App's phone inbox by lane", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
		resize(390, 844);
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
		resize(1024, 768);
	});

	const open = () =>
		testing.openConversations(
			newestFirst([
				conversation({
					id: "c1",
					task: "upload-retry",
					title: "Retry",
					status: "running",
				}),
				conversation({
					id: "c2",
					task: null,
					title: "Look around",
					status: "running",
				}),
				conversation({
					id: "c3",
					task: "upload-size",
					title: "Size",
					status: "running",
				}),
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

	it("gathers the agents at work on one lane under its title in their group", async () => {
		const view = await open();
		const working = await waitFor(() =>
			view.getByRole("region", { name: "Working" }),
		);

		const lane = within(working).getByRole("region", { name: "Uploads lane" });
		expect(lane.textContent).toContain("upload-retry");
		expect(lane.textContent).toContain("upload-size");
		expect(lane.textContent).not.toContain("Look around");
		expect(working.textContent).toContain("Look around");
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
});
