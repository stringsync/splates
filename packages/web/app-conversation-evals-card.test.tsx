import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	cleanup,
	conversation,
	fireEvent,
	message,
	Testing,
	typeIn,
	waitFor,
} from "./testing";

describe("App's run evals card", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("rejects with Anything else, telling the agent and folding the card", async () => {
		const asking = conversation({
			title: "Evals",
			messages: [
				message(
					"agent",
					"## 🔐 Permission: run evals splates: the decision probes\n\nChecks the ask-first rule.\n\n- `decisions/ask-first`",
				),
			],
		});
		const view = await testing.openConversations([asking]);
		await typeIn(
			view.getByRole("textbox", { name: "Anything else" }),
			"Too costly today.",
		);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: /Reject/ })),
		);
		await waitFor(() =>
			expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
				{
					method: "POST",
					body: {
						text: "[SPLATES RUN DENIED]\n\n> **Anything else?**\n\nToo costly today.",
					},
				},
			]),
		);
		await waitFor(() => expect(view.getByText("Evals rejected")).toBeTruthy());
	});
});
