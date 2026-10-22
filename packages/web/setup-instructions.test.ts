import { describe, expect, it } from "bun:test";
import { instructionsOf, numbered } from "./setup-instructions";

describe("instructionsOf", () => {
	it("splits the words around their numbered steps, dropping each number", () => {
		expect(
			instructionsOf("First this.\n1. Open it\n2. Press Next\n\nOr run `x`."),
		).toEqual({
			before: "First this.",
			items: ["Open it", "Press Next"],
			after: "Or run `x`.",
		});
	});

	it("reads words with no numbered line as no steps", () => {
		expect(instructionsOf("Press Next.")).toEqual({
			before: "Press Next.",
			items: [],
			after: "",
		});
		expect(numbered("Press Next.")).toBe(false);
		expect(numbered("1. Press Next")).toBe(true);
	});
});
