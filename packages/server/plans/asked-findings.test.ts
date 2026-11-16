import { describe, expect, it } from "bun:test";
import { stretches } from "./asked";

describe("stretches' findings reports", () => {
	it("keeps a report's ### sections and fenced readouts inside it, to the next ## heading", () => {
		const text = [
			"Here is the health check.",
			"",
			"## 📊 Report: test health",
			"",
			"One test fails.",
			"",
			"```stats",
			"Failing: 1",
			"```",
			"",
			"### Details",
			"",
			"1. render.test.ts",
			"",
			"## ✅ Done: checked",
		].join("\n");
		const [said, report, done] = stretches(text);
		expect(said?.type).toBe("text");
		expect(report).toEqual({
			type: "findings",
			findings: {
				subject: "test health",
				body: [
					"One test fails.",
					"",
					"```stats",
					"Failing: 1",
					"```",
					"",
					"### Details",
					"",
					"1. render.test.ts",
				].join("\n"),
			},
		});
		expect(done?.type).toBe("report");
	});

	it("reads a report with no subject", () => {
		const [report] = stretches("## 📊 Report\n\nAll good.");
		expect(report).toEqual({
			type: "findings",
			findings: { subject: "", body: "All good." },
		});
	});
});
