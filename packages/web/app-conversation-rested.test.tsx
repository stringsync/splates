import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { ConversationState } from "@stringsync/splates-server/conversations";
import { act, cleanup, Testing, tool, turn, waitFor, within } from "./testing";

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
		history.replaceState(null, "", location.pathname);
		testing.dispose();
	});

	/**
	 * The thread of `run`, opened by its address: put away, a run is listed
	 * nowhere but Archived.
	 */
	const opened = async (run: ConversationState) => {
		const view = await testing.openConversations([run], null);
		await act(async () => {
			location.hash = `#conversations/${run.id}`;
			window.dispatchEvent(new HashChangeEvent("hashchange"));
		});
		return waitFor(() => view.getByRole("region", { name: run.title ?? "" }));
	};

	it("ends a run put away with a line saying its context closed", async () => {
		const thread = await opened({ ...state, archived: true, resting: true });

		const line = within(thread).getByRole("note", { name: "run ended" });
		expect(line.textContent).toBe("Run ended, context closed");
		expect(
			[
				...thread.querySelectorAll('[data-slot="work"], [data-slot="rested"]'),
			].map((each) => each.getAttribute("data-slot")),
		).toEqual(["work", "rested"]);
	});

	it("draws no such line while the run is on", async () => {
		const thread = await opened(state);

		expect(thread.querySelector('[data-slot="work"]')).not.toBeNull();
		expect(
			within(thread).queryByRole("note", { name: "run ended" }),
		).toBeNull();
	});
});
