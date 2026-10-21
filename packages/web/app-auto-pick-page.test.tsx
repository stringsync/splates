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

	beforeEach(async () => {
		testing = new Testing();
		testing.talk = { agents: AGENTS, conversations: [] };
		testing.autoPickRules = RULES;
		view = await testing.open({
			tasks: [details({ task: "alpha", autoPick: PICKED })],
		});
		await act(async () => {
			location.hash = "#automations/auto-pick";
			window.dispatchEvent(new HashChangeEvent("hashchange"));
		});
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("lists its picks on a page of its own, each opening to what it decided", async () => {
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

	it("lists the rules whose picks were overridden, with where they moved to", async () => {
		testing.autoPickOverrides = [
			{
				rule: 1,
				count: 3,
				moves: [{ aspect: "model", to: "opus", count: 3 }],
			},
		];
		// The page read none on opening; leave it and come back.
		for (const hash of ["#automations", "#automations/auto-pick"]) {
			await act(async () => {
				location.hash = hash;
				window.dispatchEvent(new HashChangeEvent("hashchange"));
			});
		}
		await waitFor(() => view.getByText("Rule 2"));
		const overrides = view.getByRole("region", { name: "Overrides" });
		expect(overrides.textContent).toContain("3 times");
		expect(overrides.textContent).toContain("model to opus ×3");
	});

	it("opens from its card on Automations, which the nav marks, and goes back there", async () => {
		expect(view.queryByRole("tab", { name: /Auto pick/ })).toBeNull();
		const automations = view.getByRole("tab", { name: /Automations/ });
		expect(automations.className).toContain("tabs-list:bg-accent");

		await act(async () =>
			fireEvent.click(
				view.getByRole("button", { name: "Back to automations" }),
			),
		);
		expect(location.hash).toBe("#automations");
		const card = await waitFor(() =>
			view.getByRole("button", { name: /^Auto pick/ }),
		);
		await act(async () => fireEvent.click(card));

		expect(location.hash).toBe("#automations/auto-pick");
		await waitFor(() => view.getByText(/Log of picks/));
	});
});

const PICKED: AutoPicked = {
	pick: { agent: "claude", model: "haiku", effort: "low" },
	rule: 1,
	kind: "bugfix",
	depth: "shallow",
	reasons: ["Haiku, low effort", "judged: Bugfix 90%, Shallow 80%"],
	at: new Date().toISOString(),
	classified: {
		key: "k",
		classification: {
			kinds: {
				bugfix: 0.9,
				design: 0.1,
				open: 0.1,
			},
			depth: { shallow: 0.8, moderate: 0.3, deep: 0.1 },
		},
	},
};

const RULES: AutoPickRulesView = {
	rules: {
		format: 2,
		threshold: 0.5,
		rules: [
			{ kind: "open", depth: "*", picks: [{ agent: "claude" }] },
			{ kind: "*", depth: "*", picks: [{ agent: "claude" }] },
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
