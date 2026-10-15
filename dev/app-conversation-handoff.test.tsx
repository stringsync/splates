import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	cleanup,
	conversation,
	fireEvent,
	message,
	Testing,
	waitFor,
	within,
} from "./testing";

const AGENTS = [
	{ id: "claude", name: "Claude", settings: [], limits: [] },
	{
		id: "codex",
		name: "Codex",
		models: [{ id: "gpt-5.5", name: "GPT-5.5" }],
		settings: [],
		limits: [],
	},
];

describe("App's Hand off action", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("asks the agent on a task to hand it off to the agent and model picked", async () => {
		const view = await testing.openConversations(
			[conversation({ id: "c1", task: "alpha" })],
			"c1",
			{},
			AGENTS,
		);
		const actions = await waitFor(() =>
			view.getByRole("navigation", { name: "actions" }),
		);

		await act(async () =>
			fireEvent.click(
				within(actions).getByRole("button", { name: "Hand off…" }),
			),
		);
		const items = await waitFor(() => view.getAllByRole("menuitemcheckbox"));
		expect(items.map((each) => each.textContent)).toEqual(["Claude"]);
		await act(async () =>
			fireEvent.click(view.getByRole("menuitem", { name: /Codex/ })),
		);
		await act(async () =>
			fireEvent.click(
				await waitFor(() =>
					view.getByRole("menuitemcheckbox", { name: "GPT-5.5" }),
				),
			),
		);

		await waitFor(() =>
			expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
				{ method: "POST", body: { text: "[ARBOR HANDOFF TO codex gpt-5.5]" } },
			]),
		);
	});

	it("offers no handoff in a conversation with no task", async () => {
		const view = await testing.openConversations(
			[conversation({ id: "c1", task: null })],
			"c1",
			{},
			AGENTS,
		);
		const actions = await waitFor(() =>
			view.getByRole("navigation", { name: "actions" }),
		);

		expect(
			within(actions).queryByRole("button", { name: "Hand off…" }),
		).toBeNull();
	});

	it("offers no handoff for a task an orchestrator handed out", async () => {
		const view = await testing.openConversations(
			[conversation({ id: "c1", task: "alpha", handedBy: "c3" })],
			"c1",
			{},
			AGENTS,
		);
		const actions = await waitFor(() =>
			view.getByRole("navigation", { name: "actions" }),
		);

		expect(
			within(actions).queryByRole("button", { name: "Hand off…" }),
		).toBeNull();
	});

	it("shows the page's ask to hand off as a card naming the agent and model", async () => {
		const view = await testing.openConversations(
			[
				conversation({
					id: "c1",
					task: "alpha",
					messages: [message("user", "[ARBOR HANDOFF TO codex gpt-5.5]")],
				}),
			],
			"c1",
			{},
			AGENTS,
		);

		const card = await waitFor(() =>
			view.getByRole("region", { name: "hand off to codex" }),
		);
		expect(card.textContent).toContain(
			"Asked the agent to hand its task off to Codex · GPT-5.5.",
		);
	});

	it("shows a working report on a task handed on as a card, offering no archive while it works", async () => {
		const view = await testing.openConversations([
			conversation({
				messages: [
					message(
						"agent",
						[
							"## ⏳ Working header: on Claude Sonnet 5.5",
							"",
							"Every step is planned, so a cheaper model takes it.",
						].join("\n"),
					),
				],
			}),
		]);

		const working = await waitFor(() =>
			view.getByRole("region", { name: "working header" }),
		);
		expect(working.textContent).toContain("Working");
		expect(working.textContent).toContain("on Claude Sonnet 5.5");
		expect(working.textContent).toContain("a cheaper model takes it");
		expect(view.queryByRole("region", { name: "archive" })).toBeNull();
	});
});
