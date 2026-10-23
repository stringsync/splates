import { describe, expect, it } from "bun:test";
import { gateCores } from "./cores";

describe("gateCores", () => {
	it("runs a worker on each core the load leaves idle, from half the cores to all but two", () => {
		expect(gateCores(16, 1.5)).toBe(14);
		expect(gateCores(16, 5.2)).toBe(10);
		expect(gateCores(16, 10)).toBe(8);
		expect(gateCores(16, 32)).toBe(8);
		expect(gateCores(2, 0)).toBe(1);
	});
});
