import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Message } from "../conversations";
import {
	act,
	cleanup,
	conversation,
	fireEvent,
	message,
	Testing,
	waitFor,
	within,
} from "./testing";

/** A running conversation whose agent last heard the person `minutes` ago. */
function workingFor(minutes: number, ...more: Message[]) {
	return conversation({
		status: "running",
		messages: [
			{
				...message("user", "fix the header"),
				at: new Date(Date.now() - minutes * 60_000).toISOString(),
			},
			message("agent", "Reading the header."),
			...more,
		],
	});
}

describe("App's check-in on a long turn", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("asks an agent ten minutes on what it last heard where its work stands", async () => {
		const view = await testing.openConversations([workingFor(12)]);
		const bar = await waitFor(() =>
			view.getByRole("region", { name: "check in" }),
		);
		expect(bar.textContent).toContain("12m since you last spoke");

		await act(async () =>
			fireEvent.click(within(bar).getByRole("button", { name: "Check in" })),
		);

		expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
			{ method: "POST", body: { text: "[ARBOR UPDATE]" } },
		]);
	});

	it("offers none before ten minutes", async () => {
		const view = await testing.openConversations([workingFor(8)]);
		expect(view.queryByRole("region", { name: "check in" })).toBeNull();
	});

	it("offers none while a message waits for the agent", async () => {
		const view = await testing.openConversations([
			workingFor(12, { ...message("user", "and the footer"), queued: true }),
		]);
		expect(view.queryByRole("region", { name: "check in" })).toBeNull();
	});
});
