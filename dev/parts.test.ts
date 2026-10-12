import { describe, expect, it } from "bun:test";
import { nest } from "./parts";
import { details } from "./testing";

const tasks = [
	details({ task: "app", base: "main" }),
	details({ task: "api", base: "task/app" }),
	details({ task: "db", base: "task/api" }),
	details({ task: "lone", base: "task/gone" }),
];

const shape = (rows: ReturnType<typeof nest<string>>): unknown[] =>
	rows.map((each) =>
		each.parts.length === 0 ? each.row : [each.row, shape(each.parts)],
	);

describe("nest", () => {
	it("puts each part under its parent's first row, in order", () => {
		expect(
			shape(
				nest(
					["db", "app", "lone", "api", "app 2"],
					tasks,
					(row) => row.split(" ")[0] ?? null,
				),
			),
		).toEqual([["app", [["api", ["db"]]]], "lone", "app 2"]);
	});

	it("keeps a part whose parent has no row at the top", () => {
		expect(shape(nest(["db", "main"], tasks, (row) => row))).toEqual([
			"db",
			"main",
		]);
	});

	it("shows every row of a loop of bases once", () => {
		const loop = [
			details({ task: "a", base: "task/b" }),
			details({ task: "b", base: "task/a" }),
		];

		expect(shape(nest(["a", "b"], loop, (row) => row))).toEqual([["a", ["b"]]]);
	});
});
