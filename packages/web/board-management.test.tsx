import "./register-dom";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { BoardRecord } from "@splates/server/board/browser";
import { type BoardActions, BoardSwitcher } from "./board-switcher";
import { cleanup, fireEvent, render, waitFor } from "./testing-library";

describe("Board index and board header", () => {
	afterEach(cleanup);
	const boards: BoardRecord[] = [
		{ id: 1, name: "Default", position: 1, archived: false },
		{ id: 2, name: "Website", position: 2, archived: false },
	];
	const renamed: string[] = [];
	const actions: BoardActions = {
		addBoard: async () => {},
		renameBoard: async (id, name) => {
			renamed.push(`${id}: ${name}`);
		},
		archiveBoard: async () => {},
		dropBoard: async () => {},
		moveBoard: async () => {},
		moveLaneToBoard: async () => {},
	};
	beforeEach(() => {
		renamed.length = 0;
	});

	it("opens management directly from the current board's ellipsis and saves a rename", async () => {
		const view = render(
			<BoardSwitcher
				mode="current"
				boards={boards}
				current={2}
				tasks={[]}
				onPick={() => {}}
				actions={actions}
			/>,
		);
		fireEvent.click(view.getByRole("button", { name: "Website actions" }));
		fireEvent.click(await view.findByRole("menuitem", { name: "Rename" }));
		const field = await view.findByRole("textbox", { name: "Board name" });
		fireEvent.change(field, { target: { value: "Storefront" } });
		fireEvent.click(view.getByRole("button", { name: "Save" }));
		await waitFor(() => expect(renamed).toEqual(["2: Storefront"]));
	});
	it("lists boards and their ellipsis controls without a search field", () => {
		const view = render(
			<BoardSwitcher
				mode="index"
				boards={boards}
				current={1}
				tasks={[]}
				onPick={() => {}}
			/>,
		);
		expect(view.queryByRole("textbox", { name: "Find a board" })).toBeNull();
		expect(view.queryByRole("img", { name: "Permanent board" })).toBeNull();
		const builtIn = view.getByRole("region", { name: "Built-in boards" });
		expect(builtIn.textContent).toContain("Default");
		expect(builtIn.textContent).not.toContain("Website");
		expect(view.queryByRole("button", { name: "Drag Default" })).toBeNull();
		expect(view.getByRole("button", { name: "Add board" })).toBeTruthy();
		expect(view.getByRole("button", { name: "Website actions" })).toBeTruthy();
		expect(view.getByRole("button", { name: "Default actions" })).toBeTruthy();
	});
});
