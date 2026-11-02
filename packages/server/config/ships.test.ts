import { describe, expect, it } from "bun:test";
import { shipTargets } from "./ships";

describe("shipTargets", () => {
	it("lists the ships entries, filling shipStatus and afterBump from the repository", () => {
		const targets = shipTargets({
			shipStatus: "status",
			ships: {
				mdom: { packages: ["@a/mdom"], ship: "bin/mdom ship" },
				vexml: { deploys: ["@a/vexml"], ship: null, shipStatus: "own" },
			},
		});

		expect(targets).toEqual([
			{
				name: "mdom",
				paths: [],
				packages: ["@a/mdom"],
				deploys: [],
				ship: "bin/mdom ship",
				shipStatus: "status",
				afterBump: null,
			},
			{
				name: "vexml",
				paths: [],
				packages: [],
				deploys: ["@a/vexml"],
				ship: null,
				shipStatus: "own",
				afterBump: null,
			},
		]);
	});

	it("is none without ships", () => {
		expect(shipTargets({})).toEqual([]);
	});

	it("refuses bad targets", () => {
		const make =
			(
				ships: Record<
					string,
					{ packages?: string[]; deploys?: string[]; ship: string }
				>,
			) =>
			() =>
				shipTargets({ ships });

		expect(make({ "": { packages: ["a"], ship: "x" } })).toThrow("empty");
		expect(make({ a: { ship: "x" } })).toThrow("names no");
		expect(make({ a: { packages: [], ship: "x" } })).toThrow("names no");
		expect(make({ a: { packages: ["a"], deploys: ["b"], ship: "x" } })).toThrow(
			"both",
		);
		expect(
			make({
				a: { packages: ["a"], ship: "x" },
				b: { packages: ["a"], ship: "y" },
			}),
		).not.toThrow();
	});
});
