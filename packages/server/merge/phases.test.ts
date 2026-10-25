import { describe, expect, it } from "bun:test";
import { TimedPhases } from "./phases";

describe("TimedPhases", () => {
	it("sums each phase by name and leaves the rest of the run as setup", () => {
		const lines = [
			'{"phase":"biome","ms":1000}',
			'{"phase":"server tests","ms":3000}',
			'{"phase":"biome","ms":500}',
			"",
		].join("\n");

		expect(new TimedPhases(lines).of(6000)).toEqual({
			biome: 1500,
			"server tests": 3000,
			setup: 1500,
		});
	});

	it("passes over a half-written line", () => {
		expect(new TimedPhases('{"phase":"scry","ms":20}\n{"pha').of(50)).toEqual({
			scry: 20,
			setup: 30,
		});
	});
});
