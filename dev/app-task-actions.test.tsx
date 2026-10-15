import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	AGENTS,
	act,
	cleanup,
	details,
	fireEvent,
	resize,
	Testing,
	waitFor,
	within,
} from "./testing";

describe("App's task dialog on a phone", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
		resize(390, 844);
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
		resize(1024, 768);
	});

	const openTask = async (task: ReturnType<typeof details>) => {
		const view = await testing.open({ tasks: [task] });
		await act(async () => {
			location.hash = `#tasks/${task.task}`;
			dispatchEvent(new HashChangeEvent("hashchange"));
		});
		const dialog = await waitFor(() => view.getByRole("dialog"));
		return {
			view,
			bar: within(within(dialog).getByRole("toolbar", { name: "actions" })),
		};
	};

	it("keeps the most pressing action out and the rest in a menu, past two", async () => {
		testing.talk = { agents: AGENTS, conversations: [] };
		const { view, bar } = await openTask(
			details({
				task: "beta",
				status: "escalated",
				ahead: 2,
				plan: "# beta\n\n## Blocked\n\n- [ ] 1. Which way?\n",
			}),
		);

		expect(bar.getAllByRole("button").map((each) => each.textContent)).toEqual([
			"Answer a question",
			"",
		]);
		await act(async () =>
			fireEvent.click(bar.getByRole("button", { name: "More actions" })),
		);
		const items = await waitFor(() => view.getAllByRole("menuitem"));
		expect(items.map((each) => each.textContent)).toEqual([
			"Review changes",
			"Claude",
			"Codex",
			"Remove",
		]);

		// Removing still asks first, its commits not yet on main.
		await act(async () =>
			fireEvent.click(view.getByRole("menuitem", { name: "Remove" })),
		);
		expect(
			await waitFor(() => view.getByRole("heading", { name: "Remove beta?" })),
		).toBeTruthy();
	});

	it("shows two actions side by side, with no menu", async () => {
		testing.talk = { agents: AGENTS, conversations: [] };
		const { bar } = await openTask(details({ task: "beta", ahead: 0 }));

		expect(bar.getByRole("button", { name: "Remove" })).toBeTruthy();
		expect(
			bar.getByRole("button", { name: /Start a conversation/ }),
		).toBeTruthy();
		expect(bar.queryByRole("button", { name: "More actions" })).toBeNull();
	});
});
