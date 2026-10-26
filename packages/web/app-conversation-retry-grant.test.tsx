import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Event } from "@stringsync/splates-server/records";
import {
	act,
	cleanup,
	details,
	fireEvent,
	message,
	second,
	Testing,
	turn,
	waitFor,
} from "./testing";

describe("App's grant of merge attempts", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	const spent = details({
		task: "alpha",
		lease: "held",
		base: "main",
		mergeAttempts: 5,
		mergeAttemptLimit: 5,
		budgetSpent: true,
	});

	const exhausted: Event = {
		id: "m1",
		at: second(3.5),
		action: "merge",
		task: "alpha",
		reason: "budget_exhausted",
		conversation: "c1",
		base: "main",
		files: [],
		failedTests: [],
	};

	it("grants from a refused merge's line and tells the agent to merge again", async () => {
		const view = await testing.openConversations(
			[
				{
					...turn(["Merging."]),
					task: "alpha",
					name: "Landing",
					events: [exhausted],
				},
			],
			"c1",
			{ tasks: [spent] },
		);
		await act(async () =>
			fireEvent.click(
				await waitFor(() => view.getByRole("button", { name: "Grant 5 more" })),
			),
		);
		await waitFor(() => expect(view.getByText("Granted")).toBeTruthy());
		expect(testing.posted("/api/tasks/alpha/retry")).toHaveLength(1);
		await waitFor(() =>
			expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
				{ method: "POST", body: { text: "[SPLATES RETRIED]" } },
			]),
		);
	});

	it("takes the grant back, saying why, when the server refuses it", async () => {
		testing.refuseWrites = { reason: "usage", message: "attempts left" };
		const view = await testing.openConversations(
			[
				{
					...turn(["Merging."]),
					task: "alpha",
					name: "Landing",
					events: [exhausted],
				},
			],
			"c1",
			{ tasks: [spent] },
		);
		await act(async () =>
			fireEvent.click(
				await waitFor(() => view.getByRole("button", { name: "Grant 5 more" })),
			),
		);
		await waitFor(() =>
			expect(view.getByText(/Merge attempts: attempts left/)).toBeTruthy(),
		);
		expect(view.getByRole("button", { name: "Grant 5 more" })).toBeTruthy();
		expect(testing.posted("/api/conversations/c1/prompt")).toEqual([]);
	});

	it("offers Why, not Grant, once the task has attempts again", async () => {
		const view = await testing.openConversations(
			[
				{
					...turn(["Merging."]),
					task: "alpha",
					name: "Landing",
					events: [exhausted],
				},
			],
			"c1",
			{ tasks: [{ ...spent, mergeAttempts: 0, budgetSpent: false }] },
		);
		await waitFor(() => expect(view.getByRole("button", { name: "Why" })));
		expect(view.queryByRole("button", { name: /Grant/ })).toBeNull();
	});

	it("grants from the agent's retry card rather than letting it run the command", async () => {
		const view = await testing.openConversations(
			[
				{
					...turn([]),
					task: "alpha",
					name: "Landing",
					messages: [
						message(
							"agent",
							"## 🔐 Permission: run command: more merge attempts for alpha\n\n`splates retry alpha`\n\n- Each attempt conflicted.",
						),
					],
				},
			],
			"c1",
			{ tasks: [spent] },
		);
		await act(async () =>
			fireEvent.click(
				await waitFor(() =>
					view.getByRole("button", { name: "Grant attempts" }),
				),
			),
		);
		await waitFor(() =>
			expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
				{ method: "POST", body: { text: "[SPLATES RETRIED]" } },
			]),
		);
		expect(testing.posted("/api/tasks/alpha/retry")).toHaveLength(1);
		expect(view.queryByRole("region", { name: "This machine" })).toBeNull();
	});
});
