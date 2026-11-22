import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { AutoPicked, AutoPickRulesView } from "@splates/server/auto-pick";
import { routedTo } from "@splates/server/auto-pick/testing";
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

/** Waits as long as a loaded merge gate needs to open the page. */
const settled = <T,>(check: () => T) => waitFor(check, { timeout: 5000 });

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
			location.hash = "#auto-pick";
			window.dispatchEvent(new HashChangeEvent("hashchange"));
		});
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("lists its picks on a page of its own, each opening to what it decided", async () => {
		const summary = await settled(() => view.getByText(/Log of picks \(1\)/));
		await act(async () => fireEvent.click(summary));
		const line = await settled(() =>
			within(view.getByRole("list", { name: "Auto pick log" })).getByRole(
				"button",
				{ name: /alpha/ },
			),
		);
		expect(line.textContent).toContain("Haiku, low effort · Bugfix · Shallow");
		await act(async () => fireEvent.click(line));

		const log = view.getByRole("list", { name: "Auto pick log" });
		expect(log.textContent).toContain("task.started");
		expect(within(log).getByLabelText("Kind").textContent).toContain("90%");
	});

	it("lists the overridden cells, each opening to the lineups it moved between, and sends them to an agent", async () => {
		const sonnet = { model: "Sonnet 5.5", effort: "medium" };
		const opus = { model: "Opus 5.5", effort: "high" };
		testing.autoPickOverrides = [
			{
				kind: "design",
				depth: "unsure",
				count: 3,
				earlier: 0,
				moves: [{ from: sonnet, to: opus, count: 3 }],
			},
		];
		// The page read none on opening; leave it and come back.
		await act(async () => {
			location.hash = "#tasks";
			window.dispatchEvent(new HashChangeEvent("hashchange"));
		});
		await act(async () => {
			location.hash = "#auto-pick";
			window.dispatchEvent(new HashChangeEvent("hashchange"));
		});
		await settled(() => view.getByText("Design · Unsure"));
		const overrides = view.getByRole("region", { name: "Overrides" });
		expect(overrides.textContent).toContain("3 overrides across 1 cell");
		await act(async () =>
			fireEvent.click(
				within(overrides).getByRole("button", { name: "Design · Unsure" }),
			),
		);
		expect(overrides.textContent).toContain("Sonnet 5.5 · medium");
		expect(overrides.textContent).toContain("Opus 5.5 · high");
		expect(overrides.textContent).toContain("3 times");
		testing.reply = { task: 7 };
		await act(async () =>
			fireEvent.click(
				within(overrides).getByRole("button", { name: "Send to agent" }),
			),
		);
		await settled(() => view.getByText("Sent as task #7"));
		await act(async () =>
			fireEvent.click(
				within(overrides).getByRole("button", { name: "Dismiss" }),
			),
		);
		await settled(() =>
			expect(view.queryByRole("region", { name: "Overrides" })).toBeNull(),
		);
	});

	it("names a model being avoided, why and until when, and tries it at once on Use anyway", async () => {
		const last = {
			agent: "claude",
			model: "opus",
			at: "2026-07-01T11:50:00.000Z",
			status: 529,
			message: "overloaded",
		};
		testing.autoPickAvoided = [
			{
				agent: "claude",
				model: "opus",
				errors: 9,
				last,
				incident: "Elevated errors",
				until: "2026-07-01T12:20:00.000Z",
			},
		];
		await act(async () => {
			location.hash = "#tasks";
			window.dispatchEvent(new HashChangeEvent("hashchange"));
		});
		await act(async () => {
			location.hash = "#auto-pick";
			window.dispatchEvent(new HashChangeEvent("hashchange"));
		});
		const banner = await settled(() =>
			view.getByRole("region", { name: "Avoided models" }),
		);
		expect(banner.textContent).toContain("Avoiding 1 model");
		expect(banner.textContent).toContain("9 provider errors");
		expect(banner.textContent).toContain("status page: Elevated errors");
		await act(async () => {
			fireEvent.click(view.getByRole("button", { name: "Use anyway" }));
		});
		await settled(() =>
			expect(view.queryByRole("region", { name: "Avoided models" })).toBeNull(),
		);
	});

	it("is a page of the nav, which marks it, and the old Automations address opens it", async () => {
		const tab = view.getByRole("tab", { name: /Auto pick/ });
		expect(tab.getAttribute("aria-selected")).toBe("true");
		await act(async () => {
			location.hash = "#automations";
			window.dispatchEvent(new HashChangeEvent("hashchange"));
		});
		await settled(() => view.getByText(/Log of picks/));
	});

	const chooseSpare = async () => {
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Choose lineup" })),
		);
		await act(async () =>
			fireEvent.change(view.getByRole("textbox", { name: "Search lineups" }), {
				target: { value: "Spare" },
			}),
		);
		expect(view.queryByRole("radio", { name: /All/ })).toBeNull();
		await act(async () =>
			fireEvent.click(view.getByRole("radio", { name: /Spare/ })),
		);
	};
	const selectCell = async () => {
		const cell = await settled(() =>
			view.getByRole("button", { name: "Bugfix · Shallow: All" }),
		);
		await act(async () => fireEvent.click(cell));
	};
	const savedRoutes = () => ({
		...RULES,
		rules: {
			...RULES.rules,
			routes: {
				...RULES.rules.routes,
				bugfix: {
					...RULES.rules.routes.bugfix,
					shallow: "spare",
					deep: "spare",
				},
			},
		},
	});

	it("stages a searchable lineup choice then applies selected cells", async () => {
		await selectCell();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Bugfix · Deep: All" })),
		);
		await chooseSpare();
		view.getByRole("button", { name: "Bugfix · Shallow: All" });
		expect(testing.posts).toHaveLength(0);
		testing.reply = savedRoutes();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Apply" })),
		);
		view.getByRole("button", { name: "Bugfix · Shallow: Spare" });
		view.getByRole("button", { name: "Bugfix · Deep: Spare" });
		expect(view.queryByRole("complementary", { name: "Send to" })).toBeNull();
		expect(view.queryByRole("button", { name: "Saved" })).toBeNull();
	});

	it("keeps selected cells after refusal and clears them after retry", async () => {
		await selectCell();
		await chooseSpare();
		testing.refuseWrites = { reason: "unavailable", message: "Try again" };
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Apply" })),
		);
		expect(
			view.getByRole("complementary", { name: "Send to" }).textContent,
		).toContain("1 selected");
		view.getByRole("button", { name: "Bugfix · Shallow: All" });
		testing.refuseWrites = null;
		testing.reply = savedRoutes();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Apply" })),
		);
		expect(view.queryByRole("complementary", { name: "Send to" })).toBeNull();
	});

	it("uses a searchable sheet on phones and applies from below the grid", async () => {
		const { happyDOM } = window as unknown as {
			happyDOM: { setInnerWidth: (width: number) => void };
		};
		const wide = window.innerWidth;
		happyDOM.setInnerWidth(390);
		try {
			cleanup();
			view = await testing.open({ tasks: [] });
			await act(async () => {
				location.hash = "#auto-pick";
				window.dispatchEvent(new HashChangeEvent("hashchange"));
			});
			await selectCell();
			await chooseSpare();
			expect(view.queryByRole("dialog")).toBeNull();
			testing.reply = savedRoutes();
			await act(async () =>
				fireEvent.click(view.getByRole("button", { name: "Apply" })),
			);
			view.getByRole("button", { name: "Bugfix · Shallow: Spare" });
		} finally {
			happyDOM.setInnerWidth(wide);
		}
	});

	it("edits lineups inline, cancels locally and protects used lineups", async () => {
		const edit = await settled(() =>
			view.getByRole("button", { name: "Edit All" }),
		);
		await act(async () => fireEvent.click(edit));
		const all = view.getByRole("region", { name: "Lineup All" });
		expect(within(all).getByRole("button", { name: "Delete" })).toHaveProperty(
			"disabled",
			true,
		);
		await act(async () =>
			fireEvent.change(view.getByLabelText("Lineup name"), {
				target: { value: "Everything" },
			}),
		);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Cancel" })),
		);
		view.getByRole("button", { name: "Edit All" });
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Edit Spare" })),
		);
		testing.reply = {
			...RULES,
			rules: {
				...RULES.rules,
				lineups: RULES.rules.lineups.filter((each) => each.id !== "spare"),
			},
		};
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Delete" })),
		);
		expect(view.queryByRole("button", { name: "Edit Spare" })).toBeNull();
	});

	it("disables Apply during a save and shows confirmation afterwards", async () => {
		await selectCell();
		await chooseSpare();
		testing.reply = savedRoutes();
		testing.holdWrites();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Apply" })),
		);
		expect(view.getByRole("button", { name: "Applying..." })).toHaveProperty(
			"disabled",
			true,
		);
		await act(async () => testing.release());
		await settled(() =>
			view.getByText("Routes applied. Select cells to assign another lineup."),
		);
	});

	it("asks before leaving with unsaved changes, keeping them or leaving", async () => {
		await act(async () =>
			fireEvent.click(
				await settled(() =>
					view.getByRole("button", { name: "Bugfix · Shallow: All" }),
				),
			),
		);
		await act(async () =>
			fireEvent.change(
				view.getByRole("spinbutton", {
					hidden: true,
					name: "How sure the judge has to be, in percent",
				}),
				{ target: { value: "70" } },
			),
		);
		const back = () => view.getByRole("tab", { name: /Stats/ });
		const unloading = new Event("beforeunload", { cancelable: true });
		window.dispatchEvent(unloading);
		expect(unloading.defaultPrevented).toBe(true);

		await act(async () => fireEvent.click(back()));
		expect(
			view.getByRole("dialog", { name: "Leave without saving?" }),
		).toBeDefined();
		expect(location.hash).toBe("#auto-pick");

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Keep editing" })),
		);
		expect(view.queryByRole("dialog")).toBeNull();
		view.getByRole("button", { name: "Bugfix · Shallow: All" });

		await act(async () => {
			location.hash = "#tasks";
			window.dispatchEvent(new HashChangeEvent("hashchange"));
		});
		expect(location.hash).toBe("#auto-pick");
		await act(async () =>
			fireEvent.click(
				view.getByRole("button", { name: "Leave without saving" }),
			),
		);
		expect(location.hash).toBe("#tasks");
	});
});

const PICKED: AutoPicked = {
	pick: { agent: "claude", model: "haiku", effort: "low" },
	lineup: "all",
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
				devops: 0.1,
			},
			depth: { shallow: 0.8, moderate: 0.3, deep: 0.1 },
		},
	},
};

const ALL = routedTo([{ agent: "claude", model: "haiku" }]);

const RULES: AutoPickRulesView = {
	rules: {
		...ALL,
		lineups: [
			...ALL.lineups,
			{
				id: "spare",
				name: "Spare",
				color: "pink",
				picks: [{ agent: "claude" }],
			},
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
