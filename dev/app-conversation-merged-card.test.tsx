import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Outcome } from "../outcomes";
import {
	cleanup,
	conversation,
	message,
	Testing,
	waitFor,
	within,
} from "./testing";

function header(): Outcome {
	return {
		project: "/repo",
		task: "header",
		base: "main",
		ended: "merged",
		startedAt: "2026-10-14T09:20:00.000Z",
		endedAt: "2026-10-14T10:00:00.000Z",
		questionRounds: 0,
		reviewRounds: 0,
		failedMerges: 0,
		findings: [{ kind: "stopped", at: "2026-10-14T09:30:00.000Z" }],
		conversation: "c1",
		agent: null,
		model: null,
	};
}

describe("App's merged card actions", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
		testing.landed.header = { outcome: header(), baseline: null };
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("shows the systems the task touched as chips", async () => {
		testing.landed.header = {
			outcome: { ...header(), systems: ["arbor-dev", "skill"] },
			baseline: null,
		};
		const view = await testing.openConversations([
			conversation({
				messages: [message("agent", "## ✅ Merged header onto main\n\nDone.")],
			}),
		]);
		const systems = await waitFor(() =>
			view.getByRole("list", { name: "systems" }),
		);

		expect(
			within(systems)
				.getAllByRole("listitem")
				.map((item) => item.textContent),
		).toEqual(["arbor-dev", "skill"]);
	});

	it("says how many calls the person and the agent made", async () => {
		testing.landed.header = {
			outcome: {
				...header(),
				decisions: [
					{
						number: "1",
						text: "Keep the old endpoint?",
						size: "large",
						how: "asked",
						ended: "kept",
					},
					{
						number: "2",
						text: "Retry limit",
						size: "small",
						how: "assumed",
						ended: "kept",
					},
					{
						number: "3",
						text: "Button label",
						size: "small",
						how: "assumed",
						ended: "kept",
					},
				],
			},
			baseline: null,
		};
		const view = await testing.openConversations([
			conversation({
				messages: [message("agent", "## ✅ Merged header onto main\n\nDone.")],
			}),
		]);
		const went = await waitFor(() =>
			view.getByRole("region", { name: "how it went" }),
		);

		expect(within(went).getByText("1 by you")).not.toBeNull();
		expect(within(went).getByText("2 by agent")).not.toBeNull();
	});
});
