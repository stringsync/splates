import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Limit, Setting } from "../conversations";
import {
	act,
	cleanup,
	conversation,
	details,
	fireEvent,
	message,
	newWith,
	pick,
	Testing,
	todo,
	typeIn,
	waitFor,
	within,
} from "./testing";

describe("App's conversation home", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("with none open, offers the latest idle conversations to pick back up, none working, waiting, or merged", async () => {
		const view = await testing.openConversations(
			[
				conversation({ id: "c1", task: "alpha", title: "Fix login" }),
				conversation({
					id: "c7",
					task: null,
					title: "Landed",
					messages: [
						message("agent", "## ✅ Merged header onto main\n\nIt wraps."),
					],
				}),
				conversation({
					id: "c8",
					task: null,
					title: "Carried on",
					messages: [
						message("agent", "## ✅ Merged header onto main\n\nIt wraps."),
						message("user", "now the footer"),
					],
				}),
				conversation({ id: "c4", title: "Busy", status: "running" }),
				conversation({ id: "c5", task: null, title: "Look into it" }),
				conversation({
					id: "c6",
					task: null,
					lastTask: "beta",
					title: "Landed it",
				}),
				conversation({
					id: "c2",
					task: null,
					title: "Look around",
					status: "running",
					ask: {
						type: "permission",
						id: "t1",
						at: "2026-10-11T10:00:00.000Z",
						title: "rm -rf build",
						options: [{ id: "yes", name: "Allow", kind: "allow_once" }],
					},
				}),
				conversation({ id: "c3", title: "Old", archived: true }),
			],
			null,
		);
		const recent = view.getByRole("region", { name: "recent conversations" });

		expect(
			within(recent)
				.getAllByRole("button")
				.map((each) => each.textContent),
		).toEqual(["alpha", "Carried onmain", "Look into itmain", "beta"]);
		expect(within(recent).queryByRole("status")).toBeNull();
		await act(async () =>
			fireEvent.click(within(recent).getByRole("button", { name: /alpha/ })),
		);
		expect(location.hash).toBe("#conversations/c1");
	});

	it("leaves out of picking back up a conversation with a subagent at work under it, in a conversation or outside the page", async () => {
		const view = await testing.openConversations(
			[
				conversation({ id: "c1", task: null, title: "Orchestrate" }),
				conversation({
					id: "c2",
					task: "split-a",
					lastCaller: "c1",
					status: "running",
				}),
				conversation({ id: "c3", task: null, title: "Hand out" }),
				conversation({ id: "c4", task: null, title: "Settled" }),
				conversation({ id: "c5", task: "split-c", lastCaller: "c4" }),
			],
			null,
			{
				tasks: [
					details({ task: "split-a", caller: "c1" }),
					details({ task: "split-b", caller: "c3" }),
					details({ task: "split-c", caller: "c4" }),
				],
			},
		);
		const recent = view.getByRole("region", { name: "recent conversations" });

		expect(
			within(recent)
				.getAllByRole("button")
				.map((each) => each.textContent),
		).toEqual(["Settledmain", "split-c"]);
	});

	it("starts a conversation from the home composer, in the main tree with the agent picked from New and its settings, and says the message", async () => {
		const view = await testing.openConversations(
			[
				conversation({ id: "c1", title: "Latest" }),
				conversation({
					id: "c0",
					agent: "codex",
					title: "Earlier",
					// Archived, and still what Codex's settings are known from.
					archived: true,
					settings: [
						{
							id: "model",
							name: "Model",
							type: "select",
							category: "model",
							current: "big",
							options: [
								{ value: "big", name: "Big", description: null },
								{ value: "small", name: "Small", description: null },
							],
						},
					],
				}),
			],
			null,
		);
		testing.reply = conversation({
			id: "c9",
			agent: "codex",
			task: null,
			status: "starting",
		});
		// The newest conversation's agent first, and Claude's sessions have
		// offered nothing yet.
		expect(
			within(
				view.getByText("Start a conversation with")
					.parentElement as HTMLElement,
			).getByLabelText("Claude"),
		).toBeTruthy();
		expect(view.queryByRole("combobox", { name: "model" })).toBeNull();

		await newWith(view, "Codex");
		expect(location.hash).toBe("#conversations/new/codex");
		// Where Codex's last conversation left it.
		expect(view.getByRole("combobox", { name: "model" }).textContent).toContain(
			"Big",
		);
		await act(async () =>
			fireEvent.click(view.getByRole("combobox", { name: "model" })),
		);
		await pick(
			await waitFor(() => view.getByRole("option", { name: "Small" })),
		);
		const box = view.getByRole("textbox", { name: "Message input" });
		await typeIn(box, "fix the login");
		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));

		expect(testing.posted("/api/conversations")).toEqual([
			{
				method: "POST",
				body: { agent: "codex", task: null, settings: { model: "small" } },
			},
		]);
		await waitFor(() =>
			expect(testing.posted("/api/conversations/c9/prompt")).toEqual([
				{ method: "POST", body: { text: "fix the login" } },
			]),
		);
		expect(location.hash).toBe("#conversations/c9");
		expect(view.getByRole("region", { name: "fix the login" })).toBeTruthy();
	});

	it("recommends no task, lane or todo to take up", async () => {
		const view = await testing.openConversations([], null, {
			tasks: [details({ task: "header-wrap" })],
			todos: [todo({ id: 1, subject: "dark mode" })],
		});

		expect(view.queryByRole("region", { name: "recommended" })).toBeNull();
	});

	it("starts an agent's first conversation in a project with the settings its sessions left elsewhere, and says when none are known", async () => {
		const model: Setting = {
			id: "model",
			name: "Model",
			type: "select",
			category: "model",
			current: "big",
			options: [
				{ value: "big", name: "Big", description: null },
				{ value: "small", name: "Small", description: null },
			],
		};
		const view = await testing.openConversations([], null, {}, [
			{ id: "claude", name: "Claude", settings: [], limits: [] },
			{ id: "codex", name: "Codex", settings: [model], limits: [] },
		]);
		testing.reply = conversation({ id: "c9", agent: "codex", task: null });

		expect(view.queryByRole("combobox", { name: "model" })).toBeNull();
		expect(view.getByText("Settings appear once Claude starts")).toBeTruthy();

		await newWith(view, "Codex");
		expect(view.queryByText(/Settings appear once/)).toBeNull();
		expect(view.getByRole("combobox", { name: "model" }).textContent).toContain(
			"Big",
		);
		const box = view.getByRole("textbox", { name: "Message input" });
		await typeIn(box, "fix the login");
		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));

		// As shown, though never touched.
		expect(testing.posted("/api/conversations")).toEqual([
			{
				method: "POST",
				body: { agent: "codex", task: null, settings: { model: "big" } },
			},
		]);
	});

	it("shows how much of the plan is used and when each window resets, the newest said, yellow from 80% and red from 90%, for each agent that says", async () => {
		const hours = (count: number) =>
			new Date(Date.now() + count * 3_600_000).toISOString();
		const limit = (window: string, used: number, at: string): Limit => ({
			window,
			used,
			resets: hours(window === "five_hour" ? 2 : 50),
			at,
		});
		const view = await testing.openConversations(
			[
				conversation({
					id: "c1",
					usage: {
						context: null,
						input: 0,
						cached: 0,
						output: 0,
						cost: null,
						limits: [limit("five_hour", 0.95, "2026-10-11T11:00:00.000Z")],
					},
				}),
			],
			null,
			{},
			[
				{
					id: "claude",
					name: "Claude",
					settings: [],
					limits: [
						limit("five_hour", 0.5, "2026-10-11T10:00:00.000Z"),
						limit("seven_day", 0.82, "2026-10-11T10:00:00.000Z"),
						limit(
							"seven_day_overage_included",
							0.1,
							"2026-10-11T10:00:00.000Z",
						),
					],
				},
				{
					id: "codex",
					name: "Codex",
					settings: [],
					limits: [limit("43200_minutes", 0.07, "2026-10-11T10:00:00.000Z")],
				},
				{ id: "gemini", name: "Gemini", settings: [], limits: [] },
			],
		);

		const limits = view.getByRole("region", { name: "plan limits" });
		const row = (name: string) => within(limits).getByLabelText(name);
		expect(row("5-hour").textContent).toEndWith(", in 2h 0m");
		expect(within(row("5-hour")).getByText("95%").className).toContain(
			"text-destructive",
		);
		expect(row("Weekly").textContent).toEndWith(", in 2d 2h");
		expect(within(row("Weekly")).getByText("82%").className).toContain(
			"text-warning",
		);
		// Extra usage, which claude.ai's usage settings leave out, is left out.
		expect(
			within(limits).queryByLabelText("seven_day_overage_included"),
		).toBeNull();

		// Codex's windows go by their length, Claude's not among them.
		await newWith(view, "Codex");
		const codex = view.getByRole("region", { name: "plan limits" });
		expect(within(codex).getByLabelText("30-day").textContent).toContain("7%");
		expect(within(codex).queryByLabelText("5-hour")).toBeNull();

		await newWith(view, "Gemini");
		expect(view.queryByRole("region", { name: "plan limits" })).toBeNull();
	});

	it("opens the new conversation screen with the agent picked from the sidebar's menu", async () => {
		const view = await testing.openConversations([
			conversation({ id: "c1", task: "alpha", title: "Fix login" }),
		]);
		expect(view.queryByRole("region", { name: "new conversation" })).toBeNull();

		await newWith(view, "Codex");

		expect(location.hash).toBe("#conversations/new/codex");
		expect(
			within(
				view.getByText("Start a conversation with")
					.parentElement as HTMLElement,
			).getByLabelText("Codex"),
		).toBeTruthy();
	});

	it("greets with the agent of the newest conversation when none is picked", async () => {
		const view = await testing.openConversations(
			[conversation({ id: "c1", agent: "codex", title: "Latest" })],
			null,
		);

		expect(
			within(
				view.getByText("Start a conversation with")
					.parentElement as HTMLElement,
			).getByLabelText("Codex"),
		).toBeTruthy();
	});
});
