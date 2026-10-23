import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	cleanup,
	conversation,
	fireEvent,
	message,
	Testing,
	waitFor,
} from "./testing";

describe("App's run-command card", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("shows the command and answers Allow with its directive at once", async () => {
		const asking = conversation({
			title: "Build",
			messages: [
				message(
					"agent",
					"## 🔐 Permission: run command: build the web app\n\n`bun run build`\n\nAbout two minutes.",
				),
			],
		});
		const view = await testing.openConversations([asking]);
		await waitFor(() => expect(view.getByText("bun run build")).toBeTruthy());
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: /Allow/ })),
		);
		await waitFor(() => expect(view.getByText("Allowed")).toBeTruthy());
		expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
			{ method: "POST", body: { text: "[SPLATES RUN ALLOWED]" } },
		]);
	});
});
