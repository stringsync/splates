import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { AutoPicked } from "@stringsync/splates-server/auto-pick";
import type { Event } from "@stringsync/splates-server/records";
import type { Details } from "@stringsync/splates-server/tasks";
import {
	act,
	cleanup,
	conversation,
	details,
	fireEvent,
	second,
	Testing,
	todo,
	turn,
	waitFor,
	within,
} from "./testing";

describe("App's Auto pick", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	/** Opens task alpha's dialog from the Tasks page, alpha as `task` says. */
	const taskDialog = async (task: Partial<Details> = {}) => {
		testing.talk = { agents: AGENTS, conversations: [] };
		const view = await testing.open({
			tasks: [details({ task: "alpha", ...task })],
		});
		await waitFor(() =>
			view.getByRole("button", { name: /^(\d+|Nothing) waiting on you$/ }),
		);
		await act(async () =>
			fireEvent.click(view.getByRole("tab", { name: /Tasks/ })),
		);
		await act(async () =>
			fireEvent.click(
				within(view.getByRole("region", { name: "tasks" })).getByRole(
					"button",
					{ name: /alpha/ },
				),
			),
		);
		return { view, dialog: await waitFor(() => view.getByRole("dialog")) };
	};

	it("starts a task on Auto pick from its dialog's Start menu, opening its conversation at once", async () => {
		const { view, dialog } = await taskDialog();
		// Answered before the judge has, so the thread opens at once.
		testing.reply = conversation({
			id: "c9",
			task: "alpha",
			status: "starting",
			picking: true,
		});

		await act(async () =>
			fireEvent.click(
				within(dialog).getByRole("button", { name: "Start a conversation" }),
			),
		);
		const items = await waitFor(() => view.getAllByRole("menuitem"));
		// Above the agents.
		expect(items.slice(0, 3).map((each) => each.textContent)).toEqual([
			"Auto pick",
			"Claude",
			"Codex",
		]);
		await act(async () =>
			fireEvent.click(view.getByRole("menuitem", { name: "Auto pick" })),
		);

		await waitFor(() => expect(location.hash).toBe("#conversations/c9"));
		expect(
			testing.posted("/api/conversations/auto").map((post) => post.body),
		).toEqual([{ task: "alpha" }]);
		expect(testing.posted("/api/conversations")).toEqual([]);
		await waitFor(() =>
			expect(
				testing.posted("/api/conversations/c9/prompt").map((post) => post.body),
			).toMatchObject([{ text: "[SPLATES TASK alpha]" }]),
		);
		await waitFor(() =>
			expect(
				view.getAllByRole("status", {
					name: "auto pick is choosing the agent",
				}),
			).not.toHaveLength(0),
		);
	});

	it("starts a queued task on Auto pick from its dialog in one tap, closing the dialog", async () => {
		testing.talk = { agents: AGENTS, conversations: [] };
		const view = await testing.open({
			todos: [todo({ id: 3, subject: "Fix the upload", lane: 1 })],
			lanes: [{ id: 1, name: "Uploads" }],
		});
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Fix the upload" })),
		);
		const dialog = await waitFor(() => view.getByRole("dialog"));
		testing.reply = conversation({
			id: "c9",
			status: "starting",
			picking: true,
		});

		await act(async () =>
			fireEvent.click(
				within(dialog).getByRole("button", { name: "Start with Auto pick" }),
			),
		);

		await waitFor(() => expect(location.hash).toBe("#conversations/c9"));
		expect(
			testing.posted("/api/conversations/auto").map((post) => post.body),
		).toEqual([{ todo: 3 }]);
		await waitFor(() =>
			expect(
				testing.posted("/api/conversations/c9/prompt").map((post) => post.body),
			).toMatchObject([{ text: "[SPLATES TASK #3]" }]),
		);
		expect(view.queryByRole("dialog")).toBeNull();
	});

	it("shows the last Auto pick in the task's Details", async () => {
		const { dialog } = await taskDialog({ autoPick: PICKED });
		await act(async () =>
			fireEvent.click(within(dialog).getByRole("tab", { name: "Details" })),
		);

		const facts = within(dialog).getByLabelText("about the task");
		expect(facts.textContent).toContain("Auto pick");
		expect(facts.textContent).toContain("Haiku, low effort");
		expect(facts.textContent).toContain("Mechanical 90% · Easy 80%");
		expect(facts.textContent).toContain("rule 2: Mechanical, Easy");
	});

	/** The line a conversation draws for Auto pick's decision, the judge having found `signs`. */
	const lineFor = async (signs: string[] | null, judged: string) => {
		const view = await testing.openConversations([
			{ ...turn(["On it."]), events: [picked(signs, judged)] },
		]);
		return await waitFor(() => view.getByRole("note", { name: "splates" }));
	};

	it("logs the pick in the conversation, what the judge found after it and every reason on hover", async () => {
		const line = await lineFor(
			["Mechanical 90%", "Easy 80%"],
			"judged: Mechanical 90%, Easy 80%",
		);
		expect(line.textContent).toBe(
			"Auto picked Haiku, low effort: Mechanical 90%, Easy 80%",
		);
		expect(line.querySelector("[title]")?.getAttribute("title")).toBe(
			"judged: Mechanical 90%, Easy 80%\nrule 2: Mechanical, Easy",
		);
	});

	it("says why the judge found nothing when it did not answer", async () => {
		const line = await lineFor(null, "the judge took over 5s");
		expect(line.textContent).toBe(
			"Auto picked Haiku, low effort: the judge took over 5s",
		);
	});
});

/** Auto pick's decision for the conversation, the judge having found `signs`. */
function picked(signs: string[] | null, judged: string): Event {
	return {
		id: "a",
		at: second(-0.5),
		action: "auto",
		task: null,
		reason: null,
		conversation: "c1",
		agent: "claude",
		model: "haiku",
		effort: "low",
		reasons: ["Haiku, low effort", judged, "rule 2: Mechanical, Easy"],
		signs,
	};
}

const AGENTS = [
	{
		id: "claude",
		name: "Claude",
		models: [
			{ id: "opus", name: "Opus" },
			{ id: "haiku", name: "Haiku" },
		],
		settings: [],
		limits: [],
	},
	{ id: "codex", name: "Codex", settings: [], limits: [] },
];

/** What Auto pick decided for an easy mechanical task. */
const PICKED: AutoPicked = {
	pick: { agent: "claude", model: "haiku", effort: "low" },
	rule: 1,
	kind: "mechanical",
	difficulty: "easy",
	reasons: [
		"Haiku, low effort",
		"judged: Mechanical 90%, Easy 80%",
		"rule 2: Mechanical, Easy",
	],
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
