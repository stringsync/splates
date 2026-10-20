import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { UndoPlan } from "@stringsync/splates-server/setup";
import { setupProgress } from "./setup-testing";
import {
	act,
	cleanup,
	clickShown,
	fireEvent,
	resize,
	Testing,
	waitFor,
	within,
} from "./testing";

const _AGENTS = [{ id: "claude", name: "Claude", settings: [], limits: [] }];

describe("App's setup undo", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
		resize(1024, 768);
	});

	/** Opens Setup the way a person does: from its tab in the sidebar. */
	const openSetup = async (journey: string | null = "Agents") => {
		const view = await testing.open();
		await act(async () =>
			fireEvent.click(view.getByRole("tab", { name: /Setup$/ })),
		);
		if (journey !== null) {
			await clickShown(() =>
				view.getByRole("button", { name: `Set up ${journey}` }),
			);
		}
		return view;
	};

	const posted = (path: string) =>
		testing.posted(path).map((post) => post.body);

	const plan = (over: Partial<UndoPlan> = {}): UndoPlan => ({
		area: "agents",
		title: "Agents",
		steps: [
			{
				id: "agents",
				title: "Choose the agents splates starts",
				done: true,
				removes: ["Claude's models in `~/.splates/agents.json`"],
				leaves: ["Sign Claude out with `claude auth logout`"],
			},
		],
		creds: [
			{ name: "OPENAI_API_KEY", keptFor: null },
			{ name: "SPLATES_CLOUDFLARE_API_TOKEN", keptFor: "Run workers" },
		],
		confirm: null,
		refused: null,
		...over,
	});

	const openUndo = async () => {
		const view = await openSetup(null);
		await clickShown(() => view.getByRole("button", { name: "Undo Agents" }));
		return view;
	};

	it("lists what it removes, the creds it forgets and keeps, and what is left", async () => {
		testing.setup = setupProgress({ agents: "done" });
		testing.undoPlan = plan();
		const view = await openUndo();

		const dialog = await waitFor(() => view.getByRole("dialog"));
		await waitFor(() =>
			expect(dialog.textContent).toContain("Claude's models in"),
		);
		expect(dialog.textContent).toContain(
			"Forgets OPENAI_API_KEY from this device.",
		);
		expect(dialog.textContent).toContain(
			"Keeps SPLATES_CLOUDFLARE_API_TOKEN: Run workers still uses it.",
		);
		expect(dialog.textContent).toContain("Sign Claude out with");
		expect(testing.posts).toEqual([]);
	});

	it("undoes once pressed, then keeps listing what is left for the person", async () => {
		testing.setup = setupProgress({ agents: "done" });
		testing.undoPlan = plan();
		const view = await openUndo();
		testing.reply = setupProgress();

		await clickShown(() => view.getByRole("button", { name: "Undo Agents" }));

		expect(posted("/api/setup/agents/undo")).toEqual([{ confirm: null }]);
		const dialog = await waitFor(() => view.getByRole("dialog"));
		await waitFor(() =>
			expect(dialog.textContent).toContain("Agents is undone"),
		);
		expect(dialog.textContent).toContain("Left for you to remove");
		expect(dialog.textContent).toContain("Sign Claude out with");
	});

	it("holds Undo back until the name it asks for is typed", async () => {
		testing.setup = setupProgress({ agents: "done" });
		testing.undoPlan = plan({ confirm: "splates-coordinator" });
		const view = await openUndo();
		const dialog = await waitFor(() => view.getByRole("dialog"));
		const go = await waitFor(() =>
			within(dialog).getByRole("button", { name: "Undo Agents" }),
		);
		expect((go as HTMLButtonElement).disabled).toBe(true);

		fireEvent.change(within(dialog).getByLabelText(/to go ahead/), {
			target: { value: "splates-coordinator" },
		});
		expect((go as HTMLButtonElement).disabled).toBe(false);
		testing.reply = setupProgress();
		await act(async () => fireEvent.click(go));

		expect(posted("/api/setup/agents/undo")).toEqual([
			{ confirm: "splates-coordinator" },
		]);
	});

	it("says why when it cannot undo, offering no button to", async () => {
		testing.setup = setupProgress({ agents: "done" });
		testing.undoPlan = plan({
			refused: 'Undo Workers first: its "Run workers" needs "Agents".',
		});
		const view = await openUndo();

		const dialog = await waitFor(() => view.getByRole("dialog"));
		await waitFor(() =>
			expect(dialog.textContent).toContain("Undo Workers first"),
		);
		expect(
			within(dialog).queryByRole("button", { name: "Undo Agents" }),
		).toBeNull();
	});

	it("undoes a journey left partway from its page, staying there on Cancel", async () => {
		testing.setup = setupProgress({ started: ["dictation"] });
		testing.undoPlan = plan({
			area: "dictation",
			title: "Dictation",
			steps: [
				{
					id: "dictation",
					title: "Paste an OpenAI key",
					done: false,
					removes: ["The OpenAI API key kept on this device"],
					leaves: [],
				},
			],
			creds: [{ name: "OPENAI_API_KEY", keptFor: null }],
		});
		const view = await openSetup("Dictation");

		await clickShown(() =>
			view.getByRole("button", { name: "Undo Dictation" }),
		);
		const dialog = await waitFor(() => view.getByRole("dialog"));
		await waitFor(() => expect(dialog.textContent).toContain("not finished"));
		await act(async () =>
			fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" })),
		);

		await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
		expect(view.getByRole("button", { name: "Undo Dictation" })).toBeTruthy();
		expect(testing.posts).toEqual([]);
	});
});
