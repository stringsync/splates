import { describe, expect, it } from "bun:test";
import { SOUND2SCORE_LANES, sound2score } from "./example";
import { cycle, lane, lanes, mentioned, misordered, settle } from "./lanes";
import type { TodoState } from "./todo";

function todo(overrides: Partial<TodoState>): TodoState {
	return {
		id: 1,
		subject: "a todo",
		text: "",
		position: 1,
		from: null,
		createdAt: new Date().toISOString(),
		takenBy: null,
		files: [],
		blockedBy: [],
		lane: null,
		...overrides,
	};
}

/** Each lane's todo ids, top first. */
function shape(todos: TodoState[]): number[][] {
	return lanes(todos, SOUND2SCORE_LANES).map((found) =>
		found.todos.map((each) => each.id),
	);
}

describe("lanes", () => {
	it("draws the sound2score lanes as they were run", () => {
		const todos = sound2score();

		expect(shape(todos)).toEqual([
			[187, 191, 177, 196, 197, 184],
			[200, 209, 186, 208, 189],
			[207, 211, 201, 206, 198],
		]);
		const [one, two, three] = lanes(todos, SOUND2SCORE_LANES);
		expect(one?.name).toBe("Licensing");
		expect(one?.next?.id).toBe(187);
		expect(one?.ready).toBe(true);
		expect(two?.next?.id).toBe(200);
		expect(three?.blockers).toEqual([]);
	});

	it("says a lane is blocked by another once its next todo is blocked by one there", () => {
		const todos = sound2score().map((each) =>
			[200, 209].includes(each.id) ? { ...each, takenBy: "decoder" } : each,
		);

		const two = lane(todos, { id: 2, name: "Two" });

		expect(two.next?.id).toBe(186);
		expect(two.ready).toBe(false);
		expect(two.agents).toEqual(["decoder"]);
		expect(two.blockers).toEqual([
			{
				id: 177,
				subject: "Gate score exports by license tier",
				lane: 1,
				takenBy: null,
			},
		]);
	});

	it("finds a loop, naming each todo in it in merge order", () => {
		const todos = sound2score();

		expect(cycle(todos, 187, 177)).toEqual([187, 191, 177, 187]);
		expect(cycle(todos, 186, 177)).toBeNull();
		expect(cycle(todos, 5, 5)).toEqual([5, 5]);
	});

	it("moves a todo below what it comes after in its lane, and nothing else", () => {
		const one = todo({ id: 1, lane: 1, position: 1, blockedBy: [3] });
		const two = todo({ id: 2, lane: 2, position: 2 });
		const three = todo({ id: 3, lane: 1, position: 3 });
		const four = todo({ id: 4, lane: 2, position: 4, blockedBy: [5] });
		const five = todo({ id: 5, lane: null, position: 5 });

		expect(misordered([one, two, three, four, five])).toEqual({
			todo: one,
			blockedBy: three,
		});
		// #4 waits on #5 from another lane, which order does not say.
		expect(
			settle([one, two, three, four, five]).map((each) => each.id),
		).toEqual([2, 3, 1, 4, 5]);
	});

	it("reads the todos a text mentions, but not in code or links", () => {
		expect(
			mentioned(
				"After #187 and #191, see `#3` and page#2.\n\n```\n#4\n```\nAgain #187.",
			),
		).toEqual([187, 191]);
	});
});
