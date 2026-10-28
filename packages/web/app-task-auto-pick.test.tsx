import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { AutoPicked } from "@stringsync/splates-server/auto-pick";
import type { Event } from "@stringsync/splates-server/records";
import type { Details } from "@stringsync/splates-server/tasks";
import {
	act,
	cleanup,
	clickShown,
	conversation,
	details,
	fireEvent,
	openQueueRow,
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

	/** Opens task alpha's dialog from the Queue page, alpha as `task` says. */
	const taskDialog = async (task: Partial<Details> = {}) => {
		testing.talk = { agents: AGENTS, conversations: [] };
		const view = await testing.open({
			tasks: [details({ task: "alpha", ...task })],
		});
		await waitFor(() =>
			view.getByRole("button", { name: /^(\d+|Nothing) waiting on you$/ }),
		);
		await act(async () =>
			fireEvent.click(view.getByRole("tab", { name: /Queue/ })),
		);
		await openQueueRow(view, "alpha");
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

	it("starts a queued task on Auto pick from its dialog's Start menu, closing the dialog", async () => {
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
			fireEvent.click(within(dialog).getByRole("button", { name: "Start" })),
		);
		await clickShown(() => view.getByRole("menuitem", { name: "Auto pick" }));

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
		expect(facts.textContent).toContain("Bugfix 90% · Shallow 80%");
		expect(facts.textContent).toContain("rule 2: Bugfix, Shallow");
	});

	/** The line a conversation draws for Auto pick's decision, the judge having found `signs`. */
	const lineFor = async (signs: string[] | null, judged: string) => {
		const view = await testing.openConversations([
			{ ...turn(["On it."]), events: [picked(signs, judged)] },
		]);
		return await quietLine(view);
	};

	it("logs the pick in the conversation, led by its mark, with the judge findings visible", async () => {
		const line = await lineFor(
			["Bugfix 90%", "Shallow 80%"],
			"judged: Bugfix 90%, Shallow 80%",
		);
		expect(line.textContent).toContain("Auto-pickedHaiku");
		expect(line.querySelector('clipPath[id$="auto"]')).not.toBeNull();

		const found = await openFindings(line);
		expect(found.textContent).toContain("KindBugfix90%");
		expect(found.textContent).toContain("DepthShallow80%");
		expect(found.textContent).toContain("Rule 2: Bugfix, Shallow");
	});

	it("says when it moved the conversation up, and undoes the move at once", async () => {
		const view = await testing.openConversations([
			{
				...turn(["On it."]),
				events: [
					{
						...picked(["Open 90%", "Deep 80%"], "judged: Open 90%, Deep 80%"),
						model: "big",
						reasons: ["Big", "judged: Open 90%, Deep 80%"],
						lifted: { from: "Haiku, low effort", undo: { model: "haiku" } },
					} as Event,
				],
			},
		]);
		const line = await quietLine(view);
		expect(line.textContent).toContain("Auto-pickedBig");

		const findings = await openFindings(line);
		await act(async () =>
			fireEvent.click(within(findings).getByRole("button", { name: "Undo" })),
		);

		expect(findings.textContent).toContain("Back on Haiku, low effort");
		expect(testing.posted("/api/conversations/c1/setting")).toEqual([
			{ method: "PUT", body: { id: "model", value: "haiku" } },
		]);
	});

	it("says why the judge found nothing when it did not answer", async () => {
		const line = await lineFor(null, "the judge took over 5s");
		const found = await openFindings(line);
		expect(found.textContent).toContain("The judge took over 5s");
	});
});

/** Auto pick's line, drawn among the conversation's own. */
async function quietLine(view: {
	getByRole: (role: string, options: { name: string }) => HTMLElement;
}): Promise<HTMLElement> {
	return await waitFor(() => view.getByRole("note", { name: "splates" }));
}

/** The findings Auto pick's line opens, as its dotted link shows them. */
async function openFindings(line: HTMLElement): Promise<HTMLElement> {
	await act(async () =>
		fireEvent.click(line.querySelector("button") as HTMLElement),
	);
	return await waitFor(() => {
		const found = document.querySelector('[data-slot="popover-content"]');
		if (found === null) {
			throw new Error("findings not open");
		}
		return found as HTMLElement;
	});
}

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
		reasons: ["Haiku, low effort", judged, "rule 2: Bugfix, Shallow"],
		signs,
		lifted: null,
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
	kind: "bugfix",
	depth: "shallow",
	reasons: [
		"Haiku, low effort",
		"judged: Bugfix 90%, Shallow 80%",
		"rule 2: Bugfix, Shallow",
	],
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
