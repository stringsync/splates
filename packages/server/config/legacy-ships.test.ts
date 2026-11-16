import { describe, expect, it } from "bun:test";
import { shipTargets } from "./legacy-ships";

describe("shipTargets", () => {
	it("reads names, commands and ordering", () => {
		expect(
			shipTargets({
				legacyShips: {
					a: { ship: "a" },
					b: { ship: "b", dependencies: ["a"] },
				},
			}),
		).toEqual([
			{ name: "a", ship: "a", dependencies: [], dependenciesClosure: [] },
			{
				name: "b",
				ship: "b",
				dependencies: ["a"],
				dependenciesClosure: ["a"],
			},
		]);
	});
	it("is empty without targets", () => expect(shipTargets({})).toEqual([]));
	it("refuses missing commands and invalid ordering", () => {
		expect(() => shipTargets({ legacyShips: { a: { ship: "" } } })).toThrow(
			"needs a ship command",
		);
		expect(() => shipTargets({ legacyShips: { "": { ship: "x" } } })).toThrow(
			"empty",
		);
	});
	it.each([["a"], ["missing"]])("refuses invalid ordering %j", (earlier) => {
		expect(() =>
			shipTargets({
				legacyShips: { a: { ship: "x", dependencies: [earlier] } },
			}),
		).toThrow("not another target");
	});

	it("resolves dependencies with their transitive closure", () => {
		const targets = shipTargets({
			legacyShips: {
				a: { ship: "a" },
				b: { ship: "b", dependencies: ["a"] },
				c: { ship: "c", dependencies: ["b"] },
			},
		});
		expect(targets.map((each) => each.dependenciesClosure)).toEqual([
			[],
			["a"],
			["b", "a"],
		]);
	});
	it("refuses unknown or self dependencies and cycles", () => {
		expect(() =>
			shipTargets({ legacyShips: { a: { ship: "x", dependencies: ["zz"] } } }),
		).toThrow("depends on zz, which is not another target");
		expect(() =>
			shipTargets({ legacyShips: { a: { ship: "x", dependencies: ["a"] } } }),
		).toThrow("not another target");
		expect(() =>
			shipTargets({
				legacyShips: {
					a: { ship: "x", dependencies: ["b"] },
					b: { ship: "y", dependencies: ["a"] },
				},
			}),
		).toThrow("cycle: a -> b -> a");
	});

	it.each(["needs", "after"])("refuses the old %s key", (key) => {
		expect(() =>
			shipTargets({
				legacyShips: {
					a: { ship: "a" },
					b: { ship: "b", [key]: ["a"] } as never,
				},
			}),
		).toThrow("rename it to dependencies");
	});

	it.each(["packages", "deploys", "release", "shipStatus", "afterBump"])(
		"refuses removed %s with migration guidance",
		(key) => {
			expect(() =>
				shipTargets({ legacyShips: { a: { ship: "x", [key]: [] } } }),
			).toThrow("core/legacy-ship command wrapper");
		},
	);
});
