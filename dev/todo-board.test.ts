import { beforeEach, describe, expect, it } from "bun:test";
import { todo } from "./testing";
import { TodoBoard } from "./todo-board";

describe("TodoBoard", () => {
	const todos = [
		todo({ id: 1, position: 1 }),
		todo({ id: 2, position: 2 }),
		todo({ id: 3, position: 5 }),
	];
	let moves: [number, number][];
	let refuse: Error | null;
	let board: TodoBoard;

	beforeEach(() => {
		moves = [];
		refuse = null;
		board = new TodoBoard(async (id, position) => {
			moves.push([id, position]);
			if (refuse !== null) {
				throw refuse;
			}
		});
	});

	it("shows the card in hand while it is dragged", () => {
		board.lift(2);
		expect(board.show(todos).lifted?.id).toEqual(2);

		board.cancel();
		expect(board.show(todos).lifted).toBeUndefined();
	});

	it("shows a dropped card where it was let go, and moves it to the position of the card it landed on", async () => {
		board.lift(1);

		await board.drop(todos, 1, 3);

		expect(board.show(todos).ids).toEqual([2, 3, 1]);
		expect(board.show(todos).lifted).toBeUndefined();
		// position 5, not index 3: the list may show only one tag's todos
		expect(moves).toEqual([[1, 5]]);
	});

	it("gives way to the server's order once a new list arrives", async () => {
		await board.drop(todos, 1, 3);

		expect(board.show([...todos]).ids).toEqual([1, 2, 3]);
	});

	it("puts the order back when the server refuses, and throws the refusal", async () => {
		refuse = new Error("todo 1 is taken");

		await expect(board.drop(todos, 1, 3) ?? Promise.resolve()).rejects.toThrow(
			"todo 1 is taken",
		);
		expect(board.show(todos).ids).toEqual([1, 2, 3]);
	});

	it("moves nothing when dropped onto nothing, or onto itself", () => {
		board.lift(2);

		expect([board.drop(todos, 2, null), board.drop(todos, 2, 2)]).toEqual([
			null,
			null,
		]);
		expect([moves, board.show(todos).lifted]).toEqual([[], undefined]);
	});
});
