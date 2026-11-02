import { describe, expect, it } from "bun:test";
import { addedWhileQueued } from "./queued-note";

describe("addedWhileQueued", () => {
	const at = Date.UTC(2026, 10, 2, 16, 52);

	it("adds the words after the task's text, under a line that dates them", () => {
		const text = addedWhileQueued("Stop the retry.", "Mind the limit.", at);

		expect(text).toStartWith("Stop the retry.\n\n**Added while queued, ");
		expect(text).toEndWith(":**\n\nMind the limit.");
		expect(text).toContain("2026");
	});

	it("starts with the note when the task had no text", () => {
		expect(addedWhileQueued("", "Mind the limit.", at)).toStartWith(
			"**Added while queued, ",
		);
	});
});
