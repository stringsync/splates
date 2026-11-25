import { describe, expect, it } from "bun:test";
import { stretches } from "./asked";

describe("stretches' findings reports", () => {
	it("keeps a report's ### sections and fenced blocks inside it, to the next ## heading", () => {
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
		const [said, done] = stretches(text);
		expect(said).toEqual({
			type: "text",
			text: text.slice(0, text.indexOf("\n## ✅ Done:")).trim(),
		});
		expect(done?.type).toBe("report");
	});

	it("reads a report with no subject", () => {
		const [report] = stretches("## 📊 Report\n\nAll good.");
		expect(report).toEqual({ type: "text", text: "## 📊 Report\n\nAll good." });
	});
});
