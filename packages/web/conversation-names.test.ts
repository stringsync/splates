import { describe, expect, it } from "bun:test";
import { lastReport } from "./conversation-names";
import { conversation, message } from "./testing";

describe("lastReport", () => {
	const done = "## ✅ Done: looked into it\n\nNothing to change.";

	it("reads a report that is the reply's last word", () => {
		const report = lastReport(
			conversation({ id: "c1", messages: [message("agent", done)] }),
		);
		expect(report?.ending).toBe("done");
	});

	it("reads none when a question follows the report in the same reply", () => {
		const asked = `${done}\n\n1. How should I go on?\n   - (a) One way\n   - (b) Another`;
		expect(
			lastReport(
				conversation({ id: "c1", messages: [message("agent", asked)] }),
			),
		).toBeNull();
	});
});
