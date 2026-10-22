import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Limit, Setting } from "@stringsync/splates-server/conversations";
import {
	AGENTS,
	act,
	cleanup,
	conversation,
	details,
	fireEvent,
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

	it("offers only tasks no agent is left on to pick back up, opening each one's dialog", async () => {
		const view = await testing.openConversations(
			[
				conversation({ id: "c1", task: "alpha", title: "Fix login" }),
				conversation({ id: "c2", task: null, title: "Look into it" }),
				conversation({
					id: "c3",
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
				conversation({
					id: "c4",
					task: "beta",
					status: "failed",
					error: "exited 1",
				}),
			],
			null,
			{
				tasks: [
					details({ task: "alpha" }),
					details({ task: "beta" }),
					details({ task: "gamma" }),
				],
			},
		);
		await openHome();
		const picking = view.getByRole("region", { name: "pick back up" });

		expect(
			within(picking)
				.getAllByRole("button")
				.map((each) => each.textContent),
		).toEqual(["beta", "gamma"]);
		await act(async () =>
			fireEvent.click(within(picking).getByRole("button", { name: /beta/ })),
		);
		const dialog = await waitFor(() => view.getByRole("dialog"));
		expect(within(dialog).getAllByText("beta").length).toBeGreaterThan(0);
	});

	it("offers nothing to pick back up when every task has an agent on it", async () => {
		const view = await testing.openConversations(
			[
				conversation({ id: "c1", task: "alpha", title: "Fix login" }),
				conversation({ id: "c2", task: null, title: "Look into it" }),
			],
			null,
			{ tasks: [details({ task: "alpha" })] },
		);
		await openHome();

		expect(view.queryByRole("region", { name: "pick back up" })).toBeNull();
	});

	it("starts a conversation from the home composer, in the main tree with the agent picked in the header and its settings, and says the message", async () => {
		const held = [
			conversation({ id: "c1", title: "Latest" }),
			conversation({
				id: "c0",
				agent: "codex",
				title: "Earlier",
				// Archived; its settings also match the saved user defaults.
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
		];
		const view = await testing.openConversations(
			held,
			null,
			{},
			AGENTS.map((agent) => ({
				...agent,
				settings: held.find((each) => each.agent === agent.id)?.settings ?? [],
			})),
		);
		await openHome();
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
		expect(location.hash.split("?")[0]).toBe("#conversations/new/codex");
		// The saved Codex defaults.
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
				body: {
					id: "c9",
					agent: "codex",
					task: null,
					settings: { model: "small" },
				},
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

	it("keeps a setting picked on the home composer as the agent's default at once, with nothing sent", async () => {
		const settings = [
			{
				id: "model",
				name: "Model",
				type: "select" as const,
				category: "model",
				current: "big",
				options: [
					{ value: "big", name: "Big", description: null },
					{ value: "small", name: "Small", description: null },
				],
			},
		];
		const view = await testing.openConversations(
			[conversation({ id: "c1", agent: "codex", settings })],
			null,
			{},
			AGENTS.map((agent) => ({
				...agent,
				settings: agent.id === "codex" ? settings : [],
			})),
		);
		await openHome();
		await newWith(view, "Codex");

		await act(async () =>
			fireEvent.click(view.getByRole("combobox", { name: "model" })),
		);
		await pick(
			await waitFor(() => view.getByRole("option", { name: "Small" })),
		);

		await waitFor(() =>
			expect(testing.posted("/api/conversations/defaults")).toEqual([
				{
					method: "PUT",
					body: { agent: "codex", id: "model", value: "small" },
				},
			]),
		);
		expect(testing.posted("/api/conversations")).toEqual([]);
	});

	it("starts on the picked agent with Auto pick choosing its model, kept for the next New", async () => {
		const settings = [
			{
				id: "model",
				name: "Model",
				type: "select" as const,
				category: "model",
				current: "big",
				options: [
					{ value: "big", name: "Big", description: null },
					{ value: "small", name: "Small", description: null },
				],
			},
		];
		try {
			const view = await testing.openConversations(
				[conversation({ id: "c1", agent: "codex", settings })],
				null,
				{},
				AGENTS.map((agent) => ({
					...agent,
					settings: agent.id === "codex" ? settings : [],
				})),
			);
			await openHome();
			await newWith(view, "Codex");
			testing.reply = conversation({
				id: "c9",
				agent: "codex",
				task: null,
				status: "starting",
			});

			const model = view.getByRole("combobox", { name: "model" });
			await act(async () =>
				fireEvent.click(view.getByRole("switch", { name: "Auto" })),
			);
			await waitFor(() => expect(model.textContent).toContain("Auto · Big"));
			const box = view.getByRole("textbox", { name: "Message input" });
			await typeIn(box, "fix the login");
			await act(async () => fireEvent.keyDown(box, { key: "Enter" }));

			expect(testing.posted("/api/conversations")).toEqual([
				{
					method: "POST",
					body: {
						id: "c9",
						agent: "codex",
						task: null,
						settings: { model: "big" },
						autoPick: true,
					},
				},
			]);
			// Not a model, so nothing kept as the agent's default.
			expect(testing.posted("/api/conversations/defaults")).toEqual([]);
			expect(localStorage.getItem("splates.newConversationAutoModel")).toBe(
				"true",
			);
		} finally {
			localStorage.removeItem("splates.newConversationAutoModel");
		}
	});

	it("switches New's Auto pick off when the person picks a model", async () => {
		localStorage.setItem("splates.newConversationAutoModel", "true");
		const settings = [
			{
				id: "model",
				name: "Model",
				type: "select" as const,
				category: "model",
				current: "big",
				options: [
					{ value: "big", name: "Big", description: null },
					{ value: "small", name: "Small", description: null },
				],
			},
		];
		try {
			const view = await testing.openConversations(
				[conversation({ id: "c1", agent: "codex", settings })],
				null,
				{},
				AGENTS.map((agent) => ({
					...agent,
					settings: agent.id === "codex" ? settings : [],
				})),
			);
			await openHome();
			await newWith(view, "Codex");

			const model = view.getByRole("combobox", { name: "model" });
			expect(model.textContent).toContain("Auto · Big");
			await act(async () => fireEvent.click(model));
			await pick(
				await waitFor(() => view.getByRole("option", { name: "Small" })),
			);

			await waitFor(() => expect(model.textContent).not.toContain("Auto"));
			expect(localStorage.getItem("splates.newConversationAutoModel")).toBe(
				"false",
			);
		} finally {
			localStorage.removeItem("splates.newConversationAutoModel");
		}
	});

	it("shows Auto pick in New's settings while it picks the agent, switched off there for the agent it stood in with", async () => {
		const view = await testing.openConversations(
			[conversation({ id: "c1", agent: "codex" })],
			null,
		);
		await openHome();
		await newWith(view, "Auto pick");
		expect(location.hash.split("?")[0]).toBe("#conversations/new/auto");

		const settings = view.getByRole("button", { name: "settings" });
		expect(settings.textContent).toContain("Auto pick");
		await act(async () => fireEvent.click(settings));
		const dialog = await waitFor(() => view.getByRole("dialog"));
		await act(async () =>
			fireEvent.click(
				within(dialog).getByRole("switch", { name: "Auto pick" }),
			),
		);

		await waitFor(() =>
			expect(location.hash.split("?")[0]).toBe("#conversations/new/codex"),
		);
	});

	it("recommends no task, lane or todo to take up", async () => {
		const view = await testing.openConversations([], null, {
			tasks: [details({ task: "header-wrap" })],
			todos: [todo({ id: 1, subject: "dark mode" })],
		});

		expect(view.queryByRole("region", { name: "recommended" })).toBeNull();
	});

	it("preserves an unavailable explicit OpenCode request for server validation", async () => {
		const offered: Setting = {
			id: "model",
			name: "Model",
			type: "select",
			category: "model",
			current: "opencode-go/shared",
			options: [
				{ value: "opencode-go/shared", name: "Shared", description: null },
			],
		};
		const view = await testing.openConversations([], null, {}, [
			...AGENTS,
			{ id: "opencode", name: "OpenCode", settings: [offered], limits: [] },
		]);
		await act(async () => {
			location.hash = "#conversations/new/opencode?model=opencode-go%2Fremoved";
			window.dispatchEvent(new HashChangeEvent("hashchange"));
		});
		await waitFor(() =>
			expect(
				view.getByRole("combobox", { name: "model" }).textContent,
			).toContain("opencode-go/removed (unavailable)"),
		);
		testing.reply = conversation({
			id: "c9",
			agent: "opencode",
			status: "starting",
		});
		const box = view.getByRole("textbox", { name: "Message input" });
		await typeIn(box, "fixture prompt");
		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));
		const wanted = "opencode-go/removed";
		expect(testing.posted("/api/conversations")).toEqual([
			{
				method: "POST",
				body: {
					id: "c9",
					agent: "opencode",
					task: null,
					settings: { model: wanted },
					model: wanted,
					assigned: true,
				},
			},
		]);
	});
	it("sends a manually replaced OpenCode request", async () => {
		const offered: Setting = {
			id: "model",
			name: "Model",
			type: "select",
			category: "model",
			current: "opencode-go/shared",
			options: [
				{ value: "opencode-go/shared", name: "Shared", description: null },
			],
		};
		const view = await testing.openConversations([], null, {}, [
			...AGENTS,
			{ id: "opencode", name: "OpenCode", settings: [offered], limits: [] },
		]);
		await act(async () => {
			location.hash = "#conversations/new/opencode?model=opencode-go%2Fremoved";
			window.dispatchEvent(new HashChangeEvent("hashchange"));
		});
		await waitFor(() =>
			expect(
				view.getByRole("combobox", { name: "model" }).textContent,
			).toContain("opencode-go/removed (unavailable)"),
		);
		await act(async () =>
			fireEvent.click(view.getByRole("combobox", { name: "model" })),
		);
		await pick(
			await waitFor(() => view.getByRole("option", { name: /OpenCode Go/ })),
		);
		testing.reply = conversation({
			id: "c9",
			agent: "opencode",
			status: "starting",
		});
		const box = view.getByRole("textbox", { name: "Message input" });
		await typeIn(box, "fixture prompt");
		await act(async () => fireEvent.keyDown(box, { key: "Enter" }));
		const wanted = "opencode-go/shared";
		expect(testing.posted("/api/conversations")).toEqual([
			{
				method: "POST",
				body: {
					id: "c9",
					agent: "opencode",
					task: null,
					settings: { model: wanted },
					model: wanted,
					assigned: true,
				},
			},
		]);
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
		await openHome();
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
				body: {
					id: "c9",
					agent: "codex",
					task: null,
					settings: { model: "big" },
				},
			},
		]);
	});

	// scry-ignore simple-test-setup: these plan-window fixtures belong only to this test; no other home test shares them.
	it("shows how much of the plan is used and when each window resets, the newest said, yellow from 80% and red from 90%, for each agent that says", async () => {
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
		await openHome();

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

	it("opens the new conversation screen with the agent picked in its header after New is clicked", async () => {
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
		await openHome();

		expect(
			within(
				view.getByText("Start a conversation with")
					.parentElement as HTMLElement,
			).getByLabelText("Codex"),
		).toBeTruthy();
	});
});

/** Opens the new conversation screen with no agent picked, as ⌥⌘N does. */
const openHome = () =>
	act(async () =>
		fireEvent.keyDown(document.body, {
			altKey: true,
			metaKey: true,
			code: "KeyN",
		}),
	);
const hours = (count: number) =>
	new Date(Date.now() + count * 3_600_000).toISOString();
const limit = (window: string, used: number, at: string): Limit => ({
	window,
	used,
	resets: hours(window === "five_hour" ? 2 : 50),
	at,
});
