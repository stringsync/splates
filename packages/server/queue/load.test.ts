import { describe, expect, test } from "bun:test";
import { queueOverloaded } from "./load";

describe("queueOverloaded", () => {
	test("holds once the load passes the cap times the cores", () => {
		expect(queueOverloaded(1.5, { load: 36, cores: 16 })).toBe(true);
		expect(queueOverloaded(1.5, { load: 24.5, cores: 16 })).toBe(true);
	});
	test("starts while the load is at or under it", () => {
		expect(queueOverloaded(1.5, { load: 24, cores: 16 })).toBe(false);
		expect(queueOverloaded(1.5, { load: 3, cores: 16 })).toBe(false);
	});
	test("never holds with no cap", () => {
		expect(queueOverloaded(null, { load: 99, cores: 1 })).toBe(false);
	});
});
