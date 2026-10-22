import { describe, expect, it } from "bun:test";
import { DEFAULT_JOB_SIZE, jobSize, parseMemory, runnerSize } from "./job-size";

describe("a job's size", () => {
	it("reads memory as GB in the units people write it in", () => {
		expect(parseMemory("8")).toBe(8);
		expect(parseMemory("8g")).toBe(8);
		expect(parseMemory("8GB")).toBe(8);
		expect(parseMemory("0.5 GiB")).toBe(0.5);
		expect(parseMemory("512MB")).toBe(0.5);
		expect(parseMemory("1t")).toBe(1024);
		expect(parseMemory("eight")).toBeNull();
		expect(parseMemory("8 parsecs")).toBeNull();
		expect(parseMemory("0")).toBeNull();
	});

	it("takes a command's override over the project's setting over the default", () => {
		expect(jobSize(undefined)).toEqual(DEFAULT_JOB_SIZE);
		expect(jobSize({ cpus: 2 })).toEqual({ cpus: 2, memory: 8 });
		expect(jobSize({ cpus: 2, memory: "4GB" }, { memory: 1 })).toEqual({
			cpus: 2,
			memory: 1,
		});
		expect(jobSize({ memory: 16 })).toEqual({ cpus: 4, memory: 16 });
	});

	it("refuses a memory setting that is no size", () => {
		expect(() => jobSize({ memory: "lots" })).toThrow('"lots"');
	});

	it("takes a runner that says no size for the size runners were made as", () => {
		expect(runnerSize({ jobs: true, cpus: 16, memory: 32 })).toEqual({
			cpus: 16,
			memory: 32,
		});
		expect(runnerSize({ jobs: true })).toEqual(DEFAULT_JOB_SIZE);
	});
});
