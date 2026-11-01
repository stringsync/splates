import { describe, expect, it } from "bun:test";
import { shipTargets } from "./ships";

describe("shipTargets", () => {
	it("lists the ships entries, filling shipStatus and afterBump from the repository", () => {
		const targets = shipTargets(
			{
				shipStatus: "status",
				ships: {
					mdom: { paths: ["mdom/**"], ship: "bin/mdom ship" },
					vexml: { paths: ["vexml/**"], ship: null, shipStatus: "own" },
				},
			},
			"mono",
		);

		expect(targets).toEqual([
			{
				name: "mdom",
				paths: ["mdom/**"],
				ship: "bin/mdom ship",
				shipStatus: "status",
				afterBump: null,
			},
			{
				name: "vexml",
				paths: ["vexml/**"],
				ship: null,
				shipStatus: "own",
				afterBump: null,
			},
		]);
	});

	it("is the repository's one target without ships", () => {
		expect(shipTargets({ ship: "go" }, "mono")).toEqual([
			{
				name: "mono",
				paths: ["**"],
				ship: "go",
				shipStatus: null,
				afterBump: null,
			},
		]);
	});

	it("is each project without ships", () => {
		const targets = shipTargets(
			{
				ship: "go",
				projects: { a: ["a/**"], b: { paths: ["b/**"], ship: "b" } },
			},
			"mono",
		);

		expect(targets.map((target) => [target.name, target.ship])).toEqual([
			["a", "go"],
			["b", "b"],
		]);
	});

	it("refuses bad targets", () => {
		const make =
			(ships: Record<string, { paths: string[]; ship: string }>) => () =>
				shipTargets({ ships }, "mono");

		expect(make({ "": { paths: ["a/**"], ship: "x" } })).toThrow("empty");
		expect(make({ a: { paths: [], ship: "x" } })).toThrow("no paths");
		expect(make({ a: { paths: ["/a/**"], ship: "x" } })).toThrow("inside");
		expect(make({ a: { paths: ["../a"], ship: "x" } })).toThrow("inside");
		expect(
			make({
				a: { paths: ["a/**"], ship: "x" },
				b: { paths: ["a/b/**"], ship: "y" },
			}),
		).toThrow("overlap");
		expect(
			make({
				a: { paths: ["a/**"], ship: "x" },
				b: { paths: ["ab/**"], ship: "y" },
			}),
		).not.toThrow();
	});
});
