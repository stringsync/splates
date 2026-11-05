import { expect, it } from "bun:test";
import { section } from "./beforeafter";

it("reads a section without its hint comments", () => {
	const notes =
		"# t\n\n## Before\n\n<!-- today -->\n\n## After\n\nDo it.\n\n## Next\n";
	expect(section(notes, "Before")).toBe("");
	expect(section(notes, "After")).toBe("Do it.");
	expect(section(notes, "Blocked")).toBeNull();
});
