import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { AutoPicked } from "@stringsync/splates-server/auto-pick";
import { AGENTS } from "./fixtures";
import {
	act,
	cleanup,
	details,
	fireEvent,
	Testing,
	waitFor,
	within,
} from "./testing";

describe("App's Auto pick page", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("opens from the sidebar's Auto pick row, saying what started the pick and what it decided", async () => {
		testing.talk = { agents: AGENTS, conversations: [] };
		const view = await testing.open({
			tasks: [details({ task: "alpha", autoPick: PICKED })],
		});

		const row = await waitFor(
			() =>
				view.getAllByRole("button", { name: /^Auto pick/ })[0] as HTMLElement,
		);
		expect(row.textContent).toContain("Haiku, low effort");
		await act(async () => fireEvent.click(row));

		expect(location.hash).toBe("#conversations/auto-pick");
		const trigger = await waitFor(() => view.getByLabelText("Trigger"));
		expect(trigger.textContent).toContain("task.started");
		expect(trigger.textContent).toContain("alpha");
		const outcome = view.getByLabelText("Outcome");
		expect(outcome.textContent).toContain("Haiku, low effort");
		expect(outcome.textContent).toContain("Matched rule 2");
		expect(within(outcome).getByLabelText("Kind").textContent).toContain("90%");
	});
});

const PICKED: AutoPicked = {
	pick: { agent: "claude", model: "haiku", effort: "low" },
	rule: 1,
	kind: "mechanical",
	difficulty: "easy",
	reasons: ["Haiku, low effort", "judged: Mechanical 90%, Easy 80%"],
	at: new Date().toISOString(),
	classified: {
		key: "k",
		classification: {
			kinds: {
				lookup: 0.1,
				mechanical: 0.9,
				bugfix: 0.2,
				design: 0.1,
				open: 0.1,
			},
			difficulty: { easy: 0.8, medium: 0.3, hard: 0.1 },
		},
	},
};
