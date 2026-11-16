import "./register-dom";
import { afterEach, describe, expect, it } from "bun:test";
import { BoardTile, coverOf } from "./board-tile";
import { cleanup, fireEvent, render, todo } from "./testing";

describe("BoardTile", () => {
	afterEach(cleanup);

	it("names the board, counts its tasks and opens it", () => {
		const opened: string[] = [];
		const view = render(
			<BoardTile
				id={2}
				name="prod"
				tasks={[
					todo({ id: 1, stage: "running" }),
					todo({ id: 2 }),
					todo({ id: 3, blockedBy: [1] }),
				]}
				onOpen={() => opened.push("prod")}
			/>,
		);
		const tile = view.getByRole("button", { name: /prod/ });
		expect(tile.textContent).toContain("3 tasks · 2 need a look");
		expect(view.getByRole("img", { name: "Needs a look" })).toBeTruthy();
		fireEvent.click(tile);
		expect(opened).toEqual(["prod"]);
	});

	it("shows no dot when nothing needs a look", () => {
		const view = render(
			<BoardTile id={3} name="quiet" tasks={[todo()]} onOpen={() => {}} />,
		);
		expect(view.getByRole("button").textContent).toContain("1 task");
		expect(view.queryByRole("img", { name: "Needs a look" })).toBeNull();
	});

	it("keeps a board's color by its id, and the Queue slate", () => {
		expect(coverOf(2)).toEqual(coverOf(9));
		expect(coverOf(2)).not.toEqual(coverOf(3));
		expect(coverOf(0).className).toContain("slate");
	});
});
