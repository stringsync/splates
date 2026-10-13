import { describe, expect, it } from "bun:test";
import { nest } from "./parts";

const bases: Record<string, string> = {
	app: "main",
	api: "task/app",
	db: "task/api",
	lone: "task/gone",
};

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
					(row) => row.split(" ")[0] ?? null,
					(row) => bases[row.split(" ")[0] ?? ""] ?? null,
				),
			),
		).toEqual([["app", [["api", ["db"]]]], "lone", "app 2"]);
	});

	it("keeps a part whose parent has no row at the top", () => {
		expect(
			shape(
				nest(
					["db", "main"],
					(row) => row,
					(row) => bases[row] ?? null,
				),
			),
		).toEqual(["db", "main"]);
	});

	it("shows every row of a loop of bases once", () => {
		const loop: Record<string, string> = { a: "task/b", b: "task/a" };

		expect(
			shape(
				nest(
					["a", "b"],
					(row) => row,
					(row) => loop[row] ?? null,
				),
			),
		).toEqual([["a", ["b"]]]);
	});
});
