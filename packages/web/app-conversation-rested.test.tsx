import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { ConversationState } from "@stringsync/splates-server/conversations";
import { cleanup, Testing, tool, turn, waitFor, within } from "./testing";

describe("App's persistent agent runs", () => {
	let testing: Testing;
	/** A groomer run that read a file and replied. */
	let state: ConversationState;

	beforeEach(() => {
		testing = new Testing();
		state = {
			...turn([
				tool({ id: "r1", kind: "read", paths: ["/repo/a.ts"] }),
				"Groomed #4.",
			]),
			title: "Groomer",
			persistent: "groomer",
		};
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("ends a run put away with a line saying its context closed", async () => {
		const view = await testing.openConversations([
			{ ...state, archived: true, resting: true },
		]);
		const thread = await waitFor(() =>
			view.getByRole("region", { name: state.title ?? "" }),
		);

		const line = within(thread).getByRole("note", { name: "run ended" });
		expect(line.textContent).toBe("Run ended, context closed");
		expect(
			[
				...thread.querySelectorAll('[data-slot="work"], [data-slot="rested"]'),
			].map((each) => each.getAttribute("data-slot")),
		).toEqual(["work", "rested"]);
	});

	it("draws no such line while the run is on", async () => {
		const view = await testing.openConversations([state]);
		const thread = await waitFor(() =>
			view.getByRole("region", { name: state.title ?? "" }),
		);

		expect(thread.querySelector('[data-slot="work"]')).not.toBeNull();
		expect(
			within(thread).queryByRole("note", { name: "run ended" }),
		).toBeNull();
	});
});
