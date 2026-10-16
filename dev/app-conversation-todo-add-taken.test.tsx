import { afterEach, describe, expect, it } from "bun:test";
import {
	cleanup,
	second,
	Testing,
	todo,
	turn,
	waitFor,
	within,
} from "./testing";

describe("App's todo add events for a todo a task has taken", () => {
	afterEach(() => cleanup());

	it("offers no Remove", async () => {
		const testing = new Testing();
		try {
			const view = await testing.openConversations(
				[
					{
						...turn(["Noted."]),
						events: [
							{
								id: "add-4",
								at: second(2.5),
								action: "todo add",
								task: "upload-413",
								reason: null,
								conversation: "c1",
								todo: 4,
								subject: "Upload retries forever on a 413",
								lane: null,
								position: 1,
							},
						],
					},
				],
				undefined,
				{
					todos: [
						todo({
							id: 4,
							subject: "Upload retries forever on a 413",
							takenBy: "upload-413",
						}),
					],
					lanes: [],
				},
			);
			const line = await waitFor(() =>
				view.getByRole("note", { name: "arbor" }),
			);

			expect(within(line).queryByRole("button", { name: "Remove" })).toBeNull();
		} finally {
			testing.dispose();
		}
	});
});
