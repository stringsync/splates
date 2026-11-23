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
					todo({ id: 2, stage: "queued" }),
					todo({ id: 3 }),
				]}
				onOpen={() => opened.push("prod")}
			/>,
		);
		const tile = view.getByRole("button", { name: /prod/ });
		expect(tile.textContent).toContain("3 tasks · 1 queued");
		fireEvent.click(tile);
		expect(opened).toEqual(["prod"]);
	});

	it("keeps a board's color by its id, and the Queue slate", () => {
		expect(coverOf(2)).toEqual(coverOf(9));
		expect(coverOf(2)).not.toEqual(coverOf(3));
		expect(coverOf(0).className).toContain("slate");
	});
});
