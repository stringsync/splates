import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type {
	AutoPickRules,
	AutoPickRulesView,
	AutoPickTrial,
} from "@splates/server/auto-pick";
import { routedTo } from "@splates/server/auto-pick/testing";
import type { SetupProgress, StepProgress } from "@splates/server/setup";
import type { Snapshot } from "@splates/server/tasks";
import {
	act,
	cleanup,
	fireEvent,
	Testing,
	todo,
	waitFor,
	within,
} from "./testing";

describe("App's Auto pick setup", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
		testing.autoPickRules = VIEW;
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	/** Opens the Auto pick journey from the sidebar's Setup, as a person does. */
	const openAutoPick = async (todos: Snapshot["todos"] = []) => {
		const view = await testing.open({ todos });
		await act(async () =>
			fireEvent.click(view.getByRole("tab", { name: /Setup$/ })),
		);
		// The Setup page is a chunk fetched as it first opens.
		const start = await waitFor(() =>
			view.getByRole("button", { name: "Set up Auto pick" }),
		);
		await act(async () => fireEvent.click(start));
		return view;
	};

	/** The routes, once the editor has read the rules. */
	const editor = async (view: Awaited<ReturnType<typeof openAutoPick>>) =>
		waitFor(() => view.getByRole("group", { name: "Routes" }));

	/** Opens the editor for the lineup named `name`. */
	const lineup = async (
		view: Awaited<ReturnType<typeof openAutoPick>>,
		name: string,
	) => {
		await press(view.getByRole("button", { name: `Edit ${name}` }));
		return view.getByRole("region", { name: `Lineup ${name}` });
	};

	const choose = (select: HTMLElement, value: string) =>
		act(async () => fireEvent.change(select, { target: { value } }));

	const press = (button: HTMLElement) =>
		act(async () => fireEvent.click(button));

	const puts = () =>
		testing
			.posted("/api/auto-pick/rules")
			.map((post) => [post.method, post.body]);

	it("opens on the routes once a judge is kept, reading them into the editor", async () => {
		testing.setup = progress({ judge: "done" });
		const view = await openAutoPick();

		const form = await waitFor(() =>
			view.getByRole("form", { name: "Map tasks to models" }),
		);
		const routes = await editor(view);
		expect(form.textContent).toContain("~/.splates/auto-pick.json");
		within(routes).getByRole("button", { name: "Open-ended · Shallow: Open" });
		within(routes).getByRole("button", { name: "Bugfix · Deep: All" });
		expect(view.queryByRole("button", { name: "Saved" })).toBeNull();
		const open = await lineup(view, "Open");
		expect(within(open).getByLabelText("Open pick 1").textContent).toContain(
			"ClaudeHaiku",
		);
		expect(
			(within(open).getByLabelText("Open pick 1 effort") as HTMLSelectElement)
				.value,
		).toBe("low");
	});

	it("saves what was edited, shown saved at once", async () => {
		testing.setup = progress({ judge: "done" });
		const view = await openAutoPick();
		await editor(view);
		await act(async () =>
			fireEvent.change(view.getByLabelText(/How sure the judge/), {
				target: { value: "70" },
			}),
		);
		const open = await lineup(view, "Open");

		await press(
			within(open).getByRole("button", { name: "Open pick 1 model" }),
		);
		await press(await view.findByRole("menuitem", { name: "Opus" }));
		await choose(within(open).getByLabelText("Open pick 1 effort"), "max");
		await press(
			within(open).getByRole("button", { name: "Add a fallback to Open" }),
		);
		await press(await view.findByRole("menuitem", { name: "Astra" }));
		await choose(within(open).getByLabelText("Open pick 2 effort"), "medium");
		expect(view.getByRole("button", { name: "Apply" })).toBeDefined();
		const edited: AutoPickRules = {
			...RULES,
			threshold: RULES.threshold,
			lineups: [
				RULES.lineups[0] as AutoPickRules["lineups"][number],
				{
					...(RULES.lineups[1] as AutoPickRules["lineups"][number]),
					picks: [
						{ agent: "claude", model: "opus", effort: "max" },
						{ agent: "codex", model: "gpt-6-astra", effort: "medium" },
					],
				},
			],
		};
		testing.reply = { ...VIEW, rules: edited };

		await press(view.getByRole("button", { name: "Apply" }));

		expect(puts()).toEqual([["PUT", { rules: edited }]]);
		expect(view.queryByRole("button", { name: "Saved" })).toBeNull();
	});

	it("reorders a lineup's picks with a grip", async () => {
		testing.setup = progress({ judge: "done" });
		const view = await openAutoPick();
		await editor(view);
		const open = await lineup(view, "Open");
		await press(
			within(open).getByRole("button", { name: "Add a fallback to Open" }),
		);
		await press(await view.findByRole("menuitem", { name: "Astra" }));
		const picks = within(open).getByRole("list", { name: "Open picks" });
		const rows = () =>
			within(picks).getAllByRole("listitem", {
				name: /^Open pick \d+$/,
			}) as HTMLElement[];
		const [one, two] = rows() as [HTMLElement, HTMLElement];
		one.getBoundingClientRect = () => new DOMRect(0, 0, 600, 44);
		two.getBoundingClientRect = () => new DOMRect(0, 44, 600, 44);
		const grip = within(one).getByRole("button", { name: "Drag Open pick 1" });
		grip.focus();
		await act(async () => fireEvent.keyDown(grip, { code: "Space" }));
		await act(async () => fireEvent.keyDown(grip, { code: "ArrowDown" }));
		await act(async () => fireEvent.keyDown(grip, { code: "Space" }));

		expect(rows()[0]?.textContent).toContain("Codex");
		expect(rows()[1]?.textContent).toContain("Claude");
		expect(open.textContent).toContain("passed over for the next one");
	});

	it("turns pacing off, which stops its slack being edited, and saves it", async () => {
		testing.setup = progress({ judge: "done" });
		const view = await openAutoPick();
		await editor(view);

		const slack = view.getByLabelText(/How far ahead of its window/);
		expect(slack).toHaveProperty("disabled", false);
		await press(
			view.getByRole("switch", {
				name: /^Pass over a pick whose plan/,
			}),
		);
		expect(slack).toHaveProperty("disabled", true);
		await act(async () =>
			fireEvent.change(
				view.getByLabelText(/How much of a plan a pick may use/),
				{
					target: { value: "90" },
				},
			),
		);
		const edited: AutoPickRules = {
			...RULES,
			pace: { on: false, slack: 0.1, spent: 0.9 },
		};
		testing.reply = { ...VIEW, rules: edited };

		await press(view.getByRole("button", { name: "Apply settings" }));

		expect(puts()).toEqual([["PUT", { rules: edited }]]);
	});

	it("says a refused save beside it, the edit kept unsaved", async () => {
		testing.setup = progress({ judge: "done" });
		const view = await openAutoPick();
		const routes = await editor(view);
		await press(
			within(routes).getByRole("button", { name: "Bugfix · Deep: All" }),
		);
		await press(view.getByRole("button", { name: "Choose lineup" }));
		await press(view.getByRole("radio", { name: /Open/ }));
		testing.refuseWrites = {
			reason: "usage",
			message: "not Auto pick rules: the file moved",
		};

		await press(view.getByRole("button", { name: "Apply" }));

		await waitFor(() =>
			expect(view.getByRole("alert").textContent).toBe(
				"Routes not applied: not Auto pick rules: the file moved",
			),
		);
		expect(view.getByRole("button", { name: "Apply" })).toBeDefined();
		within(routes).getByRole("button", { name: "Bugfix · Deep: All" });
	});

	it("tries the rules on a task without starting it", async () => {
		testing.setup = progress({ judge: "done" });
		const view = await openAutoPick([todo({ id: 4, subject: "Rename foo" })]);
		await editor(view);
		testing.reply = progress({ judge: "done", rules: "done", tried: "done" });
		await press(view.getByRole("button", { name: "Next" }));
		await waitFor(() => view.getByRole("form", { name: "Try it on a task" }));
		const trial: AutoPickTrial = {
			subject: "Rename foo",
			cached: false,
			classification: {
				kinds: {
					bugfix: 0.9,
					design: 0.1,
					open: 0.2,
					devops: 0.1,
				},
				depth: { shallow: 0.8, moderate: 0.3, deep: 0.1 },
				clarity: { settled: 0.95, unresolved: 0.05 },
			},
			decision: {
				pick: { agent: "claude", model: "haiku", effort: "low" },
				lineup: "open",
				kind: "bugfix",
				depth: "shallow",
				clarity: "settled",
				reasons: [
					"Haiku, low effort",
					"judged: Bugfix 90%, Shallow 80%",
					"route: Bugfix · Shallow → Open",
				],
			},
		};
		testing.reply = trial;

		await press(view.getByRole("button", { name: "Try it" }));

		expect(testing.posted("/api/auto-pick/try")).toEqual([
			{ method: "POST", body: { todo: 4 } },
		]);
		const result = await waitFor(() =>
			view.getByRole("region", { name: "Auto pick would start" }),
		);
		expect(result.textContent).toContain("Haiku, low effort");
		expect(result.textContent).toContain("Bugfix · Shallow → Open");
		expect(result.textContent).toContain("route: Bugfix · Shallow → Open");
		expect(within(result).getByLabelText("Kind").textContent).toContain(
			"Bugfix90%",
		);
		expect(
			within(result).getByLabelText("User certainty").textContent,
		).toContain("Calls settled95%");
		expect(testing.posted("/api/conversations")).toEqual([]);
	});
});

/** The Auto pick area, each step as given, as the server reads it. */
function progress({
	judge = "ready",
	rules = "ready",
	tried = "waiting",
}: {
	judge?: StepProgress["status"];
	rules?: StepProgress["status"];
	tried?: StepProgress["status"];
} = {}): SetupProgress {
	const base = {
		optional: true,
		extra: false,
		problem: null,
		cred: null,
		fields: [],
		doing: null,
		detail: null,
		found: null,
		warning: null,
		data: null,
		agent: "Have the user do it on the page.",
	};
	const steps: StepProgress[] = [
		{
			...base,
			id: "auto-pick-judge",
			title: "Give Auto pick a decision model",
			why: "Auto pick asks a decision model.",
			user: "Paste a TypeSafe key.",
			after: [],
			status: judge,
			cred: "TYPESAFE_API_KEY",
			fields: [
				{
					kind: "cred",
					name: "TYPESAFE_API_KEY",
					label: "TypeSafe API key",
					help: null,
					saved: judge === "done",
					optional: false,
				},
			],
		},
		{
			...base,
			id: "auto-pick-rules",
			title: "Map tasks to models",
			why: "Each kind at each depth goes to a lineup.",
			user: "Edit the routes and lineups. They are kept in `~/.splates/auto-pick.json`.",
			after: [],
			status: rules,
		},
		{
			...base,
			id: "auto-pick-try",
			title: "Try it on a task",
			why: "See what Auto pick would do.",
			user: "Pick a task.",
			after: ["auto-pick-rules"],
			status: tried,
		},
	];
	return {
		areas: [
			{
				id: "auto-pick",
				title: "Auto pick",
				purpose: "",
				optional: false,
				done: steps.filter((step) => step.status === "done").length,
				skipped: 0,
				left: steps.filter((step) => step.status !== "done").length,
				extras: 0,
				complete: steps.every((step) => step.status === "done"),
				undoable: steps.some((step) => step.status === "done"),
				steps,
			},
		],
		next: null,
		fresh: false,
		required: false,
	};
}

const ALL = routedTo([{ agent: "claude" }]);

/** Open-ended work at every depth goes to Open, the rest to All. */
const RULES: AutoPickRules = {
	...ALL,
	lineups: [
		...ALL.lineups,
		{
			id: "open",
			name: "Open",
			color: "violet",
			picks: [{ agent: "claude", model: "haiku", effort: "low" }],
		},
	],
	routes: {
		...ALL.routes,
		open: { unsure: "open", shallow: "open", moderate: "open", deep: "open" },
	},
};

const VIEW: AutoPickRulesView = {
	rules: RULES,
	problem: null,
	agents: [
		{
			id: "claude",
			name: "Claude",
			models: [
				{ id: "haiku", name: "Haiku" },
				{ id: "opus", name: "Opus" },
			],
			efforts: ["low", "medium", "high", "max"],
		},
		{
			id: "codex",
			name: "Codex",
			models: [{ id: "gpt-6-astra", name: "Astra" }],
			efforts: null,
		},
	],
};
