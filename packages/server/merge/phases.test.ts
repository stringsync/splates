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

	it("keeps each phase's highest peak memory apart from its time", () => {
		const lines = [
			'{"phase":"server tests","ms":3000}',
			'{"phase":"server tests","peakMb":349}',
			'{"phase":"web tests","peakMb":1340}',
			'{"phase":"server tests","peakMb":1280}',
		].join("\n");

		expect(new TimedPhases(lines).peaks()).toEqual({
			"server tests": 1280,
			"web tests": 1340,
		});
		expect(new TimedPhases(lines).of(5000)).toEqual({
			"server tests": 3000,
			setup: 2000,
		});
	});
});
