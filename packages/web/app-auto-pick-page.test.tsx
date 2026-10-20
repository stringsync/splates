import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type {
	AutoPicked,
	AutoPickRulesView,
} from "@stringsync/splates-server/auto-pick";
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
	let view: Awaited<ReturnType<Testing["open"]>>;
	const realFetch = globalThis.fetch;

	beforeEach(async () => {
		testing = new Testing();
		testing.talk = { agents: AGENTS, conversations: [] };
		testing.autoPickRules = RULES;
		// The Automations page reads a list the fake has no route for.
		const fake = globalThis.fetch;
		globalThis.fetch = ((input, init) =>
			String(input).includes("/api/automations")
				? Promise.resolve(Response.json({ automations: [] }))
				: fake(input, init)) as typeof fetch;
		view = await testing.open({
			tasks: [details({ task: "alpha", autoPick: PICKED })],
		});
	});

	afterEach(() => {
		globalThis.fetch = realFetch;
		cleanup();
		testing.dispose();
	});

	it("lists its picks under Auto pick's card in Automations, each opening to what it decided", async () => {
		await act(async () => {
			location.hash = "#automations";
			window.dispatchEvent(new HashChangeEvent("hashchange"));
		});

		const summary = await waitFor(() => view.getByText(/Log of picks \(1\)/));
		await act(async () => fireEvent.click(summary));
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
	});

	it("keeps Auto pick out of the sidebar", async () => {
		await waitFor(() => view.getByRole("navigation"));
		expect(view.queryByRole("button", { name: /^Auto pick/ })).toBeNull();
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

const RULES: AutoPickRulesView = {
	rules: {
		format: 1,
		threshold: 0.5,
		rules: [
			{ kind: "lookup", difficulty: "*", picks: [{ agent: "claude" }] },
			{ kind: "*", difficulty: "*", picks: [{ agent: "claude" }] },
		],
	},
	problem: null,
	agents: [
		{
			id: "claude",
			name: "Claude",
			models: [{ id: "haiku", name: "Haiku" }],
			efforts: ["low"],
		},
	],
};
