import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type {
	AutoPickRules,
	AutoPickRulesView,
	AutoPickTrial,
} from "@stringsync/splates-server/auto-pick";
import type {
	SetupProgress,
	StepProgress,
} from "@stringsync/splates-server/setup";
import type { Snapshot } from "@stringsync/splates-server/tasks";
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

	/** The rules editor, once it has read the rules. */
	const editor = async (view: Awaited<ReturnType<typeof openAutoPick>>) =>
		waitFor(() => view.getByRole("list", { name: "Auto pick rules" }));

	const choose = (select: HTMLElement, value: string) =>
		act(async () => fireEvent.change(select, { target: { value } }));

	const press = (button: HTMLElement) =>
		act(async () => fireEvent.click(button));

	const puts = () =>
		testing
			.posted("/api/auto-pick/rules")
			.map((post) => [post.method, post.body]);

	it("opens on the rules once a judge is kept, reading them into the editor", async () => {
		testing.setup = progress({ judge: "done" });
		const view = await openAutoPick();

		const form = await waitFor(() =>
			view.getByRole("form", { name: "Map tasks to models" }),
		);
		const rules = await editor(view);
		expect(form.textContent).toContain("~/.splates/auto-pick.json");
		expect(
			(within(rules).getByLabelText("rule 1 kind") as HTMLSelectElement).value,
		).toBe("lookup");
		expect(within(rules).getByLabelText("rule 1 pick 1").textContent).toContain(
			"1ClaudeHaiku · low",
		);
		expect(view.getByText(/^(Saved|Unsaved changes)$/).textContent).toBe(
			"Saved",
		);
	});

	it("saves what was edited, shown saved at once", async () => {
		testing.setup = progress({ judge: "done" });
		const view = await openAutoPick();
		const rules = await editor(view);

		await choose(within(rules).getByLabelText("rule 1 kind"), "bugfix");
		await choose(within(rules).getByLabelText("rule 1 difficulty"), "hard");
		await press(
			within(rules).getByRole("button", { name: "Edit rule 1 pick 1" }),
		);
		await choose(await view.findByLabelText("rule 1 pick 1 model"), "opus");
		await choose(view.getByLabelText("rule 1 pick 1 thinking"), "max");
		await press(
			within(rules).getByRole("button", { name: "Add an agent to rule 1" }),
		);
		await press(await view.findByRole("menuitem", { name: "Astra" }));
		await press(
			within(rules).getByRole("button", { name: "Edit rule 1 pick 2" }),
		);
		await choose(
			await view.findByLabelText("rule 1 pick 2 thinking"),
			"medium",
		);
		await act(async () =>
			fireEvent.change(view.getByLabelText(/How sure the judge/), {
				target: { value: "70" },
			}),
		);
		expect(view.getByText(/^(Saved|Unsaved changes)$/).textContent).toBe(
			"Unsaved changes",
		);
		const edited: AutoPickRules = {
			format: 1,
			threshold: 0.7,
			rules: [
				{
					kind: "bugfix",
					difficulty: "hard",
					picks: [
						{ agent: "claude", model: "opus", effort: "max" },
						{ agent: "codex", model: "gpt-6-astra", effort: "medium" },
					],
				},
				RULES.rules[1] as AutoPickRules["rules"][number],
			],
		};
		testing.reply = { ...VIEW, rules: edited };

		await press(view.getByRole("button", { name: "Save rules" }));

		expect(puts()).toEqual([["PUT", { rules: edited }]]);
		expect(view.getByText(/^(Saved|Unsaved changes)$/).textContent).toBe(
			"Saved",
		);
	});

	it("turns pacing off, which stops its slack being edited, and saves it", async () => {
		testing.setup = progress({ judge: "done" });
		const view = await openAutoPick();
		await editor(view);

		const slack = view.getByLabelText(/How far ahead of its window/);
		expect(slack).toHaveProperty("disabled", false);
		await press(
			view.getByRole("switch", { name: /^Pass over a pick whose plan/ }),
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

		await press(view.getByRole("button", { name: "Save rules" }));

		expect(puts()).toEqual([["PUT", { rules: edited }]]);
	});

	it("keeps the last rule as any kind and any difficulty, in place", async () => {
		testing.setup = progress({ judge: "done" });
		const view = await openAutoPick();
		const rules = await editor(view);

		await press(view.getByRole("button", { name: "Add rule" }));

		const last = within(rules).getByRole("listitem", { name: "rule 3" });
		expect(last.textContent).toContain("Any kind, any difficulty");
		expect(within(last).queryByLabelText("rule 3 kind")).toBeNull();
		expect(
			within(last).queryByRole("button", { name: "Remove rule 3" }),
		).toBeNull();
		expect(
			within(rules).getByRole("button", { name: "Move rule 2 down" }),
		).toHaveProperty("disabled", true);

		await choose(within(rules).getByLabelText("rule 2 kind"), "mechanical");
		await press(within(rules).getByRole("button", { name: "Move rule 2 up" }));
		await press(within(rules).getByRole("button", { name: "Remove rule 2" }));
		expect(
			within(rules).getAllByRole("listitem", { name: /^rule \d+$/ }),
		).toHaveLength(2);
		expect(
			(within(rules).getByLabelText("rule 1 kind") as HTMLSelectElement).value,
		).toBe("mechanical");
	});

	it("says a refused save beside it, the edit kept unsaved", async () => {
		testing.setup = progress({ judge: "done" });
		const view = await openAutoPick();
		const rules = await editor(view);
		await choose(within(rules).getByLabelText("rule 1 kind"), "design");
		testing.refuseWrites = {
			reason: "usage",
			message: "not Auto pick rules: the file moved",
		};

		await press(view.getByRole("button", { name: "Save rules" }));

		await waitFor(() =>
			expect(view.getByRole("alert").textContent).toBe(
				"Not saved: not Auto pick rules: the file moved",
			),
		);
		expect(view.getByText(/^(Saved|Unsaved changes)$/).textContent).toBe(
			"Unsaved changes",
		);
		expect(
			(within(rules).getByLabelText("rule 1 kind") as HTMLSelectElement).value,
		).toBe("design");
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
					lookup: 0.1,
					mechanical: 0.9,
					bugfix: 0.1,
					design: 0.1,
					open: 0.2,
				},
				difficulty: { easy: 0.8, medium: 0.3, hard: 0.1 },
			},
			decision: {
				pick: { agent: "claude", model: "haiku", effort: "low" },
				rule: 0,
				kind: "mechanical",
				difficulty: "easy",
				reasons: [
					"Haiku, low effort",
					"judged: Mechanical 90%, Easy 80%",
					"rule 1: Mechanical, any difficulty",
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
		expect(result.textContent).toContain("Rule 1");
		expect(result.textContent).toContain("rule 1: Mechanical, any difficulty");
		expect(within(result).getByLabelText("Kind").textContent).toContain(
			"Mechanical90%",
		);
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
		problem: null,
		cred: null,
		fields: [],
		doing: null,
		detail: null,
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
				},
			],
		},
		{
			...base,
			id: "auto-pick-rules",
			title: "Map tasks to models",
			why: "The first rule that matches picks.",
			user: "Edit the rules. They are kept in `~/.splates/auto-pick.json`.",
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
				done: steps.filter((step) => step.status === "done").length,
				skipped: 0,
				left: steps.filter((step) => step.status !== "done").length,
				undoable: steps.some((step) => step.status === "done"),
				steps,
			},
		],
		next: null,
		fresh: false,
		required: false,
	};
}

const RULES: AutoPickRules = {
	format: 1,
	threshold: 0.5,
	rules: [
		{
			kind: "lookup",
			difficulty: "*",
			picks: [{ agent: "claude", model: "haiku", effort: "low" }],
		},
		{ kind: "*", difficulty: "*", picks: [{ agent: "claude" }] },
	],
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
