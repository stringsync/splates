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

	it("leaves the time of phases run side by side to the phase they ran within", () => {
		const lines = [
			'{"phase":"server tests","ms":3000,"within":"tests"}',
			'{"phase":"web tests","ms":4000,"within":"tests"}',
			'{"phase":"tests","ms":4100}',
		].join("\n");

		expect(new TimedPhases(lines).of(5000)).toEqual({
			"server tests": 3000,
			"web tests": 4000,
			tests: 4100,
			setup: 900,
		});
		expect(new TimedPhases(lines).within()).toEqual({
			"server tests": "tests",
			"web tests": "tests",
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

	it("leaves a phase's start line out of its time", () => {
		const lines = [
			'{"phase":"biome","started":"2026-10-26T10:00:00.000Z"}',
			'{"phase":"biome","ms":1000}',
		].join("\n");

		expect(new TimedPhases(lines).of(1500)).toEqual({
			biome: 1000,
			setup: 500,
		});
	});

	it("lists a running gate's phases in the order they started, timed once they end", () => {
		const lines = [
			'{"phase":"biome","started":"2026-10-26T10:00:00.000Z"}',
			'{"phase":"biome","ms":1000}',
			'{"phase":"scry","ms":20}',
			'{"phase":"tests","started":"2026-10-26T10:00:02.000Z"}',
			'{"phase":"web tests","started":"2026-10-26T10:00:02.100Z","within":"tests"}',
			'{"pha',
		].join("\n");

		expect(new TimedPhases(lines).live()).toEqual([
			{ phase: "biome", at: "2026-10-26T10:00:00.000Z", ms: 1000 },
			{ phase: "scry", ms: 20 },
			{ phase: "tests", at: "2026-10-26T10:00:02.000Z" },
			{
				phase: "web tests",
				at: "2026-10-26T10:00:02.100Z",
				within: "tests",
			},
		]);
	});
});
