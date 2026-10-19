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
		const line = await waitFor(() =>
			within(view.getByRole("list", { name: "Auto pick log" })).getByRole(
				"button",
				{ name: /alpha/ },
			),
		);
		expect(line.textContent).toContain("Haiku, low effort · rule 2");
		await act(async () => fireEvent.click(line));

		const log = view.getByRole("list", { name: "Auto pick log" });
		expect(log.textContent).toContain("task.started");
		expect(within(log).getByLabelText("Kind").textContent).toContain("90%");
		await act(async () =>
			fireEvent.click(within(log).getByRole("button", { name: "Edit rule 2" })),
		);

		// The rules are edited in Automations, set on the rule that picked.
		expect(location.hash).toBe("#automations/auto-pick/2");
		await waitFor(() => view.getByRole("region", { name: "automations" }));
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
