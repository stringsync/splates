import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	cleanup,
	conversation,
	message,
	Testing,
	waitFor,
	within,
} from "./testing";

describe("Working report elapsed time", () => {
	let testing: Testing;
	beforeEach(() => {
		testing = new Testing();
	});
	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("keeps a working card's elapsed time when another agent message follows", async () => {
		const view = await testing.openConversations([
			conversation({
				messages: [
					message("agent", {
						type: "text",
						text: "## ⏳ Working alpha: on Claude Sonnet\n\nFollowing the plan.",
						at: "2026-10-17T12:00:00.000Z",
					}),
					message("agent", {
						type: "text",
						text: "Here is what I found.",
						at: "2026-10-17T12:02:14.000Z",
					}),
				],
			}),
		]);
		const working = await waitFor(() =>
			view.getByRole("region", { name: "working alpha" }),
		);
		expect(
			within(working).getByRole("timer", { name: "Elapsed time" }).textContent,
		).toBe("2m 14s");
		expect(working.textContent).toContain("Worked");
		expect(working.textContent).not.toContain("Working");
	});

	it("says Working while no agent message follows", async () => {
		const view = await testing.openConversations([
			conversation({
				messages: [
					message("agent", {
						type: "text",
						text: "## ⏳ Working alpha: on Claude Sonnet\n\nFollowing the plan.",
						at: "2026-10-17T12:00:00.000Z",
					}),
				],
			}),
		]);
		const working = await waitFor(() =>
			view.getByRole("region", { name: "working alpha" }),
		);
		expect(working.textContent).toContain("Working");
		expect(working.textContent).not.toContain("Worked");
	});
});
