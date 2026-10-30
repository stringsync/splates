import { describe, expect, it } from "bun:test";
import { shown } from "./refusal";

const lines = (count: number) =>
	Array.from({ length: count }, (_, i) => `error ${i + 1}`).join("\n");

describe("shown", () => {
	it("shows an output within the caps whole", () => {
		expect(shown(lines(400))).toBe(lines(400));
	});

	it("keeps the start and end of a longer one, and says where all of it is", () => {
		const text = shown(lines(1000), "/tmp/gate.log");
		expect(text).toContain("error 1\n");
		expect(text).toContain("error 100\n");
		expect(text).not.toContain("error 101\n");
		expect(text).toContain("error 1000");
		expect(text).toContain("error 701\n");
		expect(text).not.toContain("error 700\n");
		expect(text).toContain(
			"600 lines omitted; the complete output is in /tmp/gate.log",
		);
	});

	it("cuts a few very long lines by characters", () => {
		const long = "x".repeat(100_000);
		expect(shown(long).length).toBeLessThan(41_000);
	});
});
