import { describe, expect, it } from "bun:test";
import { named } from "./composer-drafts";

describe("named", () => {
	const csv = new File(["x"], "a.csv", { type: "text/csv" });
	const png = new File(["x"], "a.png", { type: "image/png" });

	it("writes the chip of a file the words never name after them", () => {
		expect(named("look [Image 1]", [csv, png])).toBe("look [Image 1] [File 1]");
	});

	it("leaves words that name every file as they are", () => {
		expect(named("[File 1] look [Image 1]", [csv, png])).toBe(
			"[File 1] look [Image 1]",
		);
	});

	it("names a file alone", () => {
		expect(named("", [csv])).toBe("[File 1]");
	});
});
