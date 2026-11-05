import { afterEach, expect, it } from "bun:test";
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

let testing: Testing;
afterEach(() => {
	cleanup();
	testing.dispose();
});

it("opens an Active eval's conversation through the app router", async () => {
	testing = new Testing();
	const view = await testing.openConversations(
		[
			conversation({
				id: "eval-chat",
				name: "Eval conversation",
				messages: [
					message("user", "[SPLATES EVAL LOOP scenario decisions/ask-first]"),
				],
			}),
			conversation({
				id: "other-chat",
				name: "Other conversation",
				messages: [message("user", "Other topic")],
			}),
		],
		"other-chat",
	);
	await act(async () => {
		location.hash = "#evals/active";
		window.dispatchEvent(new HashChangeEvent("hashchange"));
	});
	const active = await waitFor(() =>
		view.getByRole("region", { name: "Active eval conversations" }),
	);
	fireEvent.click(
		within(active).getByRole("button", { name: /Eval conversation/ }),
	);
	await waitFor(() => expect(location.hash).toBe("#conversations/eval-chat"));
	await waitFor(() =>
		expect(
			view.queryByRole("region", { name: "Active eval conversations" }),
		).toBeNull(),
	);
	expect(
		view.getByRole("heading", { name: /^Eval conversation$/ }),
	).toBeTruthy();
});
