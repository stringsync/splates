import "./register-dom";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { BoardRecord } from "@splates/server/board/browser";
import { type BoardActions, BoardSwitcher } from "./board-switcher";
import { cleanup, fireEvent, render, waitFor } from "./testing-library";

describe("BoardSwitcher controls", () => {
	const boards: BoardRecord[] = [
		{ id: 1, name: "Default", position: 1, archived: false },
		{ id: 2, name: "Website", position: 2, archived: false },
	];

	const calls: string[] = [];
	const actions: BoardActions = {
		addBoard: async () => {},
		renameBoard: async () => {},
		archiveBoard: async (id, archived) => {
			calls.push(`archive ${id} ${archived}`);
		},
		dropBoard: async (id) => {
			calls.push(`drop ${id}`);
		},
		moveBoard: async (id, position) => {
			calls.push(`move ${id} ${position}`);
		},
		moveLaneToBoard: async (lane, board) => {
			calls.push(`lane ${lane} -> ${board}`);
		},
	};

	function open() {
		const view = render(
			<BoardSwitcher
				boards={boards}
				current={1}
				tasks={[
					{ id: 1, lanes: [1], tasks: [] },
					{ id: 2, lanes: [7, 8], tasks: [] },
				]}
				onPick={() => {}}
				actions={actions}
			/>,
		);
		fireEvent.click(view.getByRole("button", { name: "Switch board" }));
		return view;
	}

	beforeEach(() => {
		calls.length = 0;
		localStorage.clear();
	});
	afterEach(cleanup);

	it("offers a drag grip on each board, and none while a filter hides some", () => {
		const view = open();
		expect(view.getByRole("button", { name: "Drag Default" })).toBeTruthy();
		expect(view.getByRole("button", { name: "Drag Website" })).toBeTruthy();
		fireEvent.change(view.getByLabelText("Find a board"), {
			target: { value: "web" },
		});
		expect(view.queryByRole("button", { name: "Drag Website" })).toBeNull();
	});

	it("moves a board's lanes to the picked board, then deletes it", async () => {
		const view = open();
		fireEvent.click(
			await view.findByRole("button", { name: "Website actions" }),
		);
		fireEvent.click(await view.findByRole("menuitem", { name: /Delete/ }));
		fireEvent.click(await view.findByRole("button", { name: "Delete board" }));
		await waitFor(() =>
			expect(calls).toEqual(["lane 7 -> 1", "lane 8 -> 1", "drop 2"]),
		);
	});

	it("archives a board", async () => {
		const view = open();
		fireEvent.click(
			await view.findByRole("button", { name: "Website actions" }),
		);
		fireEvent.click(await view.findByRole("menuitem", { name: /Archive/ }));
		await waitFor(() => expect(calls).toEqual(["archive 2 true"]));
	});

	it("keeps Default from being archived or deleted", async () => {
		const view = open();
		fireEvent.click(
			await view.findByRole("button", { name: "Default actions" }),
		);
		await view.findByRole("menuitem", { name: /Rename/ });
		expect(view.queryByRole("menuitem", { name: /Delete/ })).toBeNull();
		expect(view.queryByRole("menuitem", { name: /Archive/ })).toBeNull();
	});
});
