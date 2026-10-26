import { expect, it } from "bun:test";
import { removedReport } from "./continuity";

it("finds the Removed report for a task", () => {
	const reply = "## 🛑 Removed continuity: moot\n\nIt set out to write a file.";
	expect(removedReport(reply, "continuity")).toBe(
		"## 🛑 Removed continuity: moot",
	);
	expect(removedReport(reply, "other")).toBeNull();
	expect(removedReport("## ✅ Done: nothing", "continuity")).toBeNull();
});
