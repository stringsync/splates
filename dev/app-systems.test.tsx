import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { NamedSystem } from "../systems";
import {
	act,
	cleanup,
	details,
	fireEvent,
	Testing,
	todo,
	waitFor,
	within,
} from "./testing";

const BOARD: NamedSystem = {
	name: "board",
	aliases: ["lanes"],
	globs: ["src/board/**", "src/gone/**"],
};
const SKILLS: NamedSystem = { name: "skills", globs: ["skills/**"] };

describe("App's Systems page", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
		testing.systems = [BOARD, SKILLS];
		testing.changes = {
			systems: [
				{
					name: "board",
					files: 12,
					unmatched: ["src/gone/**"],
					changed: 14,
					changes: [
						{
							hash: "abcdef1234567890",
							at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
							author: "Ada",
							subject: "Drag a card on a phone",
						},
					],
				},
				{ name: "skills", files: 3, unmatched: [], changed: 0, changes: [] },
			],
			since: "2026-09-01T00:00:00Z",
			scanned: 500,
			uncovered: 40,
			groups: Array.from({ length: 10 }, (_, at) => ({
				glob: `src/part${at}/*`,
				files: 4,
				changed: 10 - at,
			})),
		};
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
		history.replaceState(null, "", " ");
	});

	async function openSystems() {
		const view = await testing.open({
			tasks: [
				details({ task: "drag-fix", systems: [BOARD] }),
				details({ task: "elsewhere" }),
			],
			todos: [
				todo({
					id: 4,
					subject: "Lanes forget their order",
					text: "In #lanes.",
				}),
				todo({ id: 5, subject: "Mentions `#board` in code only" }),
			],
		});
		await act(async () =>
			fireEvent.click(view.getByRole("tab", { name: /Systems/ })),
		);
		return view;
	}

	it("lists each system with how often it changed and its latest change", async () => {
		const view = await openSystems();
		const list = await waitFor(() =>
			view.getByRole("list", { name: "system list" }),
		);

		await waitFor(() => {
			expect(within(list).getByText("14 changes")).toBeTruthy();
			expect(within(list).getByText("Drag a card on a phone")).toBeTruthy();
			expect(within(list).getByText("0 changes")).toBeTruthy();
		});
		expect(location.hash).toBe("#systems");
	});

	it("opens a system to what it is made of, what names it, and its changes", async () => {
		const view = await openSystems();
		await waitFor(() => view.getByText("Drag a card on a phone"));

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: /board/ })),
		);

		const page = view.getByRole("region", { name: "system board" });
		expect(location.hash).toBe("#systems/board");
		expect(within(page).getByText("12 files on trunk")).toBeTruthy();
		expect(within(page).getByRole("alert").textContent).toContain(
			"src/gone/**",
		);
		const tasks = within(page).getByRole("list", { name: "tasks in it" });
		expect(within(tasks).getByText("drag-fix")).toBeTruthy();
		expect(within(tasks).queryByText("elsewhere")).toBeNull();
		// Named by its alias counts; named only in code does not.
		const todos = within(page).getByRole("list", { name: "todos naming it" });
		expect(within(todos).getByText("Lanes forget their order")).toBeTruthy();
		expect(within(todos).queryByText(/in code only/)).toBeNull();
		expect(within(page).getByText("The latest 1 of 14.")).toBeTruthy();

		const copied: string[] = [];
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: { writeText: async (text: string) => void copied.push(text) },
		});
		const commit = within(page).getByRole("button", {
			name: "copy commit abcdef12",
		});
		await act(async () => fireEvent.click(commit));
		expect(copied).toEqual(["abcdef12 Drag a card on a phone"]);
		// It says so in place, with no toast.
		expect(commit.textContent).toBe("Copied");

		await act(async () => fireEvent.click(within(tasks).getByText("drag-fix")));
		expect(location.hash).toBe("#tasks/drag-fix");
	});

	it("lists the globs no system covers, the most changed first, each copied", async () => {
		const copied: string[] = [];
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: { writeText: async (text: string) => void copied.push(text) },
		});
		const view = await openSystems();
		const globs = await waitFor(() =>
			view.getByRole("list", { name: "uncovered globs" }),
		);

		expect(view.getByText("40 files")).toBeTruthy();
		const rows = within(globs).getAllByRole("button");
		expect(rows.map((row) => row.getAttribute("aria-label"))).toEqual(
			Array.from({ length: 8 }, (_, at) => `copy src/part${at}/*`),
		);
		expect(within(globs).getByText("4 files · 10 changes")).toBeTruthy();
		expect(view.getByText("And 2 more globs.")).toBeTruthy();

		await act(async () => fireEvent.click(rows[0] as HTMLElement));
		expect(copied).toEqual(["src/part0/*"]);
		expect(rows[0]?.textContent).toContain("Copied");
	});

	it("goes back to the list", async () => {
		const view = await openSystems();
		await act(async () =>
			fireEvent.click(
				await waitFor(() => view.getByRole("button", { name: /skills/ })),
			),
		);
		expect(view.getByText("No recent commit changed it.")).toBeTruthy();

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Back to systems" })),
		);

		expect(view.getByRole("list", { name: "system list" })).toBeTruthy();
		expect(location.hash).toBe("#systems");
	});

	it("opens a system found with ⌘K", async () => {
		const view = await testing.open();
		await act(async () =>
			fireEvent.keyDown(window, { key: "k", code: "KeyK", metaKey: true }),
		);
		const box = await waitFor(() =>
			view.getByRole("textbox", { name: "search" }),
		);
		await act(async () =>
			fireEvent.change(box, { target: { value: "lanes" } }),
		);
		const results = view.getByRole("list", { name: "results" });
		await waitFor(() => within(results).getByText("board"));

		await act(async () => fireEvent.click(within(results).getByText("board")));

		expect(location.hash).toBe("#systems/board");
		await waitFor(() => view.getByRole("region", { name: "system board" }));
	});
});
