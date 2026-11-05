import { describe, expect, it } from "bun:test";
import { reminderCardFor } from "./reminder-of";

const plan = (before: string, after: string) =>
	`# t\n\n## Before\n\n${before}\n\n## After\n\n${after}\n`;

describe("reminderCardFor", () => {
	it("leads with After's first sentence and keeps the rest of it", () => {
		expect(
			reminderCardFor("t", plan("Tabs split it.", "One page. Sections fold.")),
		).toEqual({
			task: "t",
			line: "One page.",
			before: "Tabs split it.",
			after: "Sections fold.",
		});
	});

	it("leaves After empty when the line is all of it", () => {
		expect(reminderCardFor("t", plan("", "One page."))?.after).toBe("");
	});

	it("does not end the line at an abbreviation", () => {
		expect(
			reminderCardFor("t", plan("", "Chips, e.g. a package name. More."))?.line,
		).toBe("Chips, e.g. a package name.");
	});

	it("takes a line with no full stop whole", () => {
		expect(reminderCardFor("t", plan("", "Chips for areas"))?.line).toBe(
			"Chips for areas",
		);
	});

	it("drops hints and pictures, which a card cannot show", () => {
		expect(
			reminderCardFor(
				"t",
				plan(
					"<!-- today -->\n\n![shot](/a.png)",
					"One page.\n\n![mock](/b.png)",
				),
			),
		).toEqual({ task: "t", line: "One page.", before: "", after: "" });
	});

	it("has no card while After says nothing, or there is no record", () => {
		expect(reminderCardFor("t", plan("Tabs.", "<!-- hint -->"))).toBeNull();
		expect(reminderCardFor("t", null)).toBeNull();
	});

	it("reads a legacy Goal as After", () => {
		expect(reminderCardFor("t", "# t\n\n## Goal\n\nOne page.\n")?.line).toBe(
			"One page.",
		);
	});
});
