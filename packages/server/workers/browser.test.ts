import { describe, expect, it } from "bun:test";
import { strained } from "./browser";

describe("strained", () => {
	const calm = { cpu: 0.5, memory: 0.5, temperature: 50 };

	it("is false below red", () => {
		expect(strained(calm)).toBe(false);
		expect(strained({ ...calm, temperature: null })).toBe(false);
		expect(strained({ ...calm, cpu: 0.89, memory: 0.89 })).toBe(false);
	});

	it("is true once any one reading is red", () => {
		expect(strained({ ...calm, cpu: 0.9 })).toBe(true);
		expect(strained({ ...calm, memory: 0.9 })).toBe(true);
		expect(strained({ ...calm, temperature: 95 })).toBe(true);
	});
});
