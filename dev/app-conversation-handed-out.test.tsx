import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	cleanup,
	conversation,
	details,
	fireEvent,
	message,
	newestFirst,
	Testing,
	waitFor,
	within,
} from "./testing";

describe("App's conversation of a task another handed out", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	const orchestrator = conversation({
		id: "orch",
		name: "Stats lane",
		messages: [message("user", "[ARBOR LANE 1]")],
	});
	const agent = conversation({
		id: "agent",
		task: "alpha",
		status: "running",
		handedBy: "orch",
		lastCaller: "orch",
		messages: [message("user", "[ARBOR TASK alpha]")],
	});
	const ask = {
		type: "permission" as const,
		id: "t1",
		at: "2026-10-11T10:00:00.000Z",
		title: "rm -rf build",
		options: [
			{ id: "yes", name: "Allow", kind: "allow_once" as const },
			{ id: "no", name: "Reject", kind: "reject_once" as const },
		],
	};
	const tasks = [details({ task: "alpha", caller: "orch", handedTo: "agent" })];
	const escalated = {
		...agent,
		status: "idle" as const,
		messages: [
			message("user", "[ARBOR TASK alpha]"),
			message(
				"agent",
				"## ⚠️ Escalated alpha: on the wording\n\n1. Which wording?\n   - (a) Hey\n   - (b) Oi",
			),
		],
	};
	const merged = {
		...agent,
		status: "idle" as const,
		unread: true,
		messages: [
			message("user", "[ARBOR TASK alpha]"),
			message("agent", "## ✅ Merged alpha onto main"),
		],
	};

	const option = (value: string, name: string) => ({
		value,
		name,
		description: null,
	});
	const tuned = {
		...agent,
		settings: [
			{
				id: "model",
				name: "Model",
				type: "select" as const,
				category: "model",
				current: "opus",
				options: [option("sonnet", "Sonnet 5.5"), option("opus", "Opus 5.5")],
			},
			{
				id: "effort",
				name: "Effort",
				type: "select" as const,
				category: "thought_level",
				current: "high",
				options: [option("low", "Low"), option("high", "High")],
			},
			{
				id: "fast",
				name: "Fast mode",
				type: "boolean" as const,
				category: null,
				current: "off",
				options: [option("on", "On"), option("off", "Off")],
			},
		],
		usage: { ...agent.usage, context: { used: 84_000, size: 200_000 } },
	};

	it("points to the orchestrator in place of the composer, and opens it", async () => {
		const view = await testing.openConversations(
			newestFirst([orchestrator, agent]),
			"agent",
			{ tasks },
		);

		const note = await waitFor(() =>
			view.getByRole("note", { name: "handed out" }),
		);
		expect(within(note).getByText(/which it reports to/).textContent).toBe(
			"Handed out by Stats lane, which it reports to. Talk to it there.",
		);
		expect(view.queryByRole("textbox", { name: "Message input" })).toBeNull();
		expect(
			view.getByText("This conversation is read-only.").parentElement
				?.textContent,
		).toBe("This conversation is read-only. Only Stats lane writes to it.");

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Stats lane" })),
		);
		await waitFor(() => view.getByRole("textbox", { name: "Message input" }));
	});

	it("shows its model, effort and context read-only in place of the composer's", async () => {
		const view = await testing.openConversations(
			newestFirst([orchestrator, tuned]),
			"agent",
			{ tasks },
		);

		const note = await waitFor(() =>
			view.getByRole("note", { name: "handed out" }),
		);
		expect(within(note).getByText("Opus 5.5 · High")).toBeTruthy();
		within(note).getByRole("button", { name: "42% of context used" });
		expect(view.queryByRole("combobox")).toBeNull();
	});

	it("sends you to the orchestrator to carry on once its agent stops", async () => {
		const view = await testing.openConversations(
			newestFirst([
				orchestrator,
				{ ...agent, status: "failed", error: "ACP connection closed" },
			]),
			"agent",
			{ tasks },
		);

		const alert = await waitFor(() => view.getByRole("alert"));
		expect(alert.textContent).toContain(
			"The agent stopped. Ask Stats lane to carry on.",
		);
		await act(async () =>
			fireEvent.click(
				within(alert).getByRole("button", { name: "Stats lane" }),
			),
		);
		await waitFor(() => view.getByRole("textbox", { name: "Message input" }));
	});

	it("shows the orchestrator a line when its agent goes quiet", async () => {
		const view = await testing.openConversations(
			newestFirst([
				{
					...orchestrator,
					messages: [
						...orchestrator.messages,
						message("user", "[ARBOR IDLE alpha]"),
					],
				},
				agent,
			]),
			"orch",
			{ tasks },
		);

		const chip = await waitFor(() => view.getByTitle("Task alpha"));
		expect(chip.closest('[role="note"]')?.textContent).toBe("Idlealpha");
	});

	it("shows nothing for a task handed out stopping, leaving it to the orchestrator's report", async () => {
		const view = await testing.openConversations(
			newestFirst([
				{
					...orchestrator,
					messages: [
						...orchestrator.messages,
						message("user", "[ARBOR REPORT alpha]"),
						message("agent", "## ⏳ Working lanes Stats: on beta"),
					],
				},
				agent,
			]),
			"orch",
			{ tasks },
		);

		await waitFor(() => view.getByRole("region", { name: "working Stats" }));
		expect(view.queryByText(/handed out here/)).toBeNull();
		expect(view.queryByText("[ARBOR REPORT alpha]")).toBeNull();
	});

	it("shows its escalation's questions read-only, answered through the orchestrator", async () => {
		const view = await testing.openConversations(
			newestFirst([orchestrator, escalated]),
			"agent",
			{ tasks },
		);

		const card = await waitFor(() =>
			view.getByRole("region", { name: "escalated alpha" }),
		);
		expect(within(card).getByText("Which wording?")).toBeTruthy();
		expect(within(card).queryByRole("textbox")).toBeNull();
		expect(
			within(card).queryByRole("button", { name: /Send|Copy/ }),
		).toBeNull();
	});

	it("leaves its escalation to the orchestrator in the list, marking only that one waiting on you", async () => {
		const view = await testing.openConversations(
			newestFirst([
				orchestrator,
				{
					...agent,
					status: "stopped" as const,
					messages: [
						message("user", "[ARBOR TASK alpha]"),
						message("agent", "## ⚠️ Escalated alpha: on the wording"),
					],
				},
			]),
			"orch",
			{
				tasks: [
					details({
						task: "alpha",
						caller: "orch",
						handedTo: "agent",
						status: "escalated",
						escalation: "on the wording",
					}),
				],
			},
		);
		const nav = view.getByRole("navigation", { name: "conversations" });

		await waitFor(() =>
			within(nav).getByRole("button", { name: "More for alpha" }),
		);
		expect(
			within(nav)
				.getAllByRole("status", { name: "waiting on you" })
				.map(
					(each) => each.closest("li")?.querySelector("button")?.textContent,
				),
		).toEqual(["Stats lane"]);
	});

	// scry-ignore simple-test-setup: the working orchestrator it opens with is what it checks, and no other test does
	it("marks the orchestrator working in the list while its agent works", async () => {
		const view = await testing.openConversations(
			newestFirst([
				{
					...orchestrator,
					unread: true,
					messages: [
						message("user", "[ARBOR LANE 1]"),
						message("agent", "## ⏳ Working lanes Stats: alpha on Opus"),
					],
				},
				agent,
			]),
			"agent",
			{ tasks },
		);
		const nav = view.getByRole("navigation", { name: "conversations" });

		await waitFor(() =>
			within(nav).getByRole("button", { name: "More for alpha" }),
		);
		expect(
			within(nav)
				.getAllByRole("status", { name: "working" })
				.map(
					(each) => each.closest("li")?.querySelector("button")?.textContent,
				),
		).toEqual(["Stats lane", "alpha"]);
	});

	it("shows no dot for it in the list, its name muted, once it merged unread", async () => {
		const view = await testing.openConversations(
			newestFirst([orchestrator, merged]),
			"orch",
			{ tasks },
		);
		const nav = view.getByRole("navigation", { name: "conversations" });
		const more = await within(nav).findByRole("button", {
			name: "More for alpha",
		});

		const row = more.closest("li") as HTMLElement;
		expect(within(row).queryByRole("img", { name: "merged" })).toBeNull();
		expect(within(row).queryByRole("status", { name: "unread" })).toBeNull();
		expect(within(row).getByText("alpha").className).toContain("italic");
	});

	it("offers no archive or rename of it, only of the orchestrator", async () => {
		const view = await testing.openConversations(
			newestFirst([orchestrator, agent]),
			"orch",
			{ tasks },
		);
		const nav = view.getByRole("navigation", { name: "conversations" });

		expect(
			within(nav)
				.queryAllByRole("button", { name: /^Archive / })
				.map((each) => each.getAttribute("aria-label")),
		).toEqual(["Archive Stats lane"]);
		await act(async () =>
			fireEvent.click(
				within(nav).getByRole("button", { name: "More for alpha" }),
			),
		);
		expect(
			view.getAllByRole("menuitem").map((each) => each.textContent),
		).toEqual(["Copy link", "Mark as unread", "Move under…"]);
	});

	it("terminates its agent from where the composer was", async () => {
		const view = await testing.openConversations(
			newestFirst([orchestrator, agent]),
			"agent",
			{ tasks },
		);

		await act(async () =>
			fireEvent.click(
				await waitFor(() => view.getByRole("button", { name: "Terminate" })),
			),
		);

		expect(testing.posted("/api/conversations/agent/terminate")).toEqual([
			{ method: "POST", body: {} },
		]);
	});

	it("asks the orchestrator's person what its agent wants to run", async () => {
		const view = await testing.openConversations(
			newestFirst([orchestrator, { ...agent, ask }]),
			"orch",
			{ tasks },
		);

		const card = await waitFor(() =>
			view.getByRole("generic", { name: "permission" }),
		);
		expect(card.textContent).toContain("alpha");
		await act(async () =>
			fireEvent.click(
				within(card).getByRole("button", { name: "This session" }),
			),
		);

		expect(testing.posted("/api/conversations/agent/answer")).toEqual([
			{
				method: "POST",
				body: { ask: "t1", answer: { type: "permission", option: "yes" } },
			},
		]);
	});

	it("names the agents archiving the orchestrator takes with it", async () => {
		const view = await testing.openConversations(
			newestFirst([orchestrator, agent]),
			"orch",
			{ tasks },
		);
		const nav = view.getByRole("navigation", { name: "conversations" });

		await act(async () =>
			fireEvent.click(
				within(nav).getByRole("button", { name: "Archive Stats lane" }),
			),
		);

		expect(view.getByRole("dialog").textContent).toContain(
			"stopping any at work, and unarchiving it brings them back: alpha (working).",
		);
		expect(testing.posted("/api/conversations/orch/archived")).toEqual([]);
	});

	it("gives it the composer back once the orchestrator is gone", async () => {
		const view = await testing.openConversations([agent], "agent", { tasks });

		await waitFor(() => view.getByRole("textbox", { name: "Message input" }));
		expect(view.queryByRole("note", { name: "handed out" })).toBeNull();
	});
});
