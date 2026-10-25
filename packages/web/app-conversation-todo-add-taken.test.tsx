import { afterEach, describe, expect, it } from "bun:test";
import { workTimeline } from "./drivers";
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
								action: "task add",
								task: "upload-413",
								reason: null,
								conversation: "c1",
								number: 4,
								subject: "Upload retries forever on a 413",
								lane: null,
								position: 1,
								ready: true,
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
			const thread = await waitFor(() =>
				view.getByRole("region", { name: "Tests" }),
			);
			const line = await waitFor(() => {
				const found = workTimeline(thread).querySelector<HTMLElement>(
					'[data-slot="quiet-event"]',
				);
				expect(found?.textContent).toContain("Added");
				return found as HTMLElement;
			});

			expect(within(line).queryByRole("button", { name: "Remove" })).toBeNull();
		} finally {
			testing.dispose();
		}
	});
});
