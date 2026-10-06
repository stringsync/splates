import { beforeEach, describe, expect, it } from "bun:test";
import { todo } from "./testing";
import { TodoBoard } from "./todo-board";

describe("TodoBoard", () => {
	const todos = [
		todo({ id: 1, position: 1 }),
		todo({ id: 2, position: 2 }),
		todo({ id: 3, position: 5 }),
		todo({ id: 4, position: 6, lane: 1 }),
		todo({ id: 5, position: 7, lane: 1 }),
	];
	let writes: unknown[][];
	let refuse: Error | null;
	let board: TodoBoard;

	beforeEach(() => {
		writes = [];
		refuse = null;
		const write = async (...args: unknown[]) => {
			writes.push(args);
			if (refuse !== null) {
				throw refuse;
			}
		};
		board = new TodoBoard({
			move: (id, position) => write("move", id, position),
			arrange: (id, lane, before, name) =>
				name === undefined
					? write("arrange", id, lane, before)
					: write("arrange", id, lane, before, name),
		});
	});

	/** Each todo's id and lane as the board shows them. */
	const shown = () =>
		board.show(todos).todos.map((each) => [each.id, each.lane]);

	it("shows the card in hand while it is dragged", () => {
		board.lift(2);
		expect(board.show(todos).lifted?.id).toEqual(2);

		board.cancel();
		expect(board.show(todos).lifted).toBeUndefined();
	});

	it("shows a dropped card where it was let go, and moves it to the position of the card it landed on", async () => {
		board.lift(1);

		await board.drop(todos, 1, { card: 3 });

		expect(shown().map(([id]) => id)).toEqual([2, 3, 1, 4, 5]);
		expect(board.show(todos).lifted).toBeUndefined();
		// position 5, not index 3: the column may show only part of the list
		expect(writes).toEqual([["move", 1, 5]]);
	});

	it("puts a card dropped onto another lane's card just above it, in that lane", async () => {
		await board.drop(todos, 2, { card: 5 });

		expect(shown()).toEqual([
			[1, null],
			[3, null],
			[4, 1],
			[2, 1],
			[5, 1],
		]);
		expect(writes).toEqual([["arrange", 2, 1, 5]]);
	});

	it("puts a card dropped onto a lane's space at its bottom, or into a new lane", async () => {
		await board.drop(todos, 1, { lane: 1 });
		expect(shown().slice(-1)).toEqual([[1, 1]]);
		expect(writes).toEqual([["arrange", 1, 1, undefined]]);

		// A new lane waits for its name before anything is written.
		expect(board.drop([...todos], 2, { lane: "new" })).toBeNull();
		expect(board.naming).toBe(2);
		expect(writes).toHaveLength(1);
		await board.name([...todos], "Docs");
		expect(board.naming).toBeNull();
		expect(writes.at(-1)).toEqual(["arrange", 2, "new", undefined, "Docs"]);
		await board.drop([...todos], 4, { lane: null });
		expect(writes.at(-1)).toEqual(["arrange", 4, null, undefined]);
	});

	it("gives way to the server's order once a new list arrives", async () => {
		await board.drop(todos, 1, { card: 3 });

		expect(board.show([...todos]).todos.map((each) => each.id)).toEqual([
			1, 2, 3, 4, 5,
		]);
	});

	it("puts the order back when the server refuses, and throws the refusal", async () => {
		refuse = new Error("todo 5 comes after todo 4");

		await expect(
			board.drop(todos, 5, { card: 4 }) ?? Promise.resolve(),
		).rejects.toThrow("todo 5 comes after todo 4");
		expect(shown().map(([id]) => id)).toEqual([1, 2, 3, 4, 5]);
	});

	it("moves nothing when dropped onto nothing, itself, or the lane it is in", () => {
		board.lift(2);

		expect([
			board.drop(todos, 2, null),
			board.drop(todos, 2, { card: 2 }),
			board.drop(todos, 4, { lane: 1 }),
		]).toEqual([null, null, null]);
		expect([writes, board.show(todos).lifted]).toEqual([[], undefined]);
	});
});
