import { describe, expect, it } from "bun:test";
import { plannedFiles } from "./plan";

describe("plannedFiles", () => {
	it("takes each top-level bullet under ## Files, without backticks", () => {
		const plan = [
			"# alpha",
			"",
			"## Files",
			"",
			"Phase 1:",
			"",
			"- `a.ts`",
			"- b/{c,d}.ts",
			"  - nested note",
			"",
			"## Next",
			"",
			"- [ ] not a file",
		].join("\n");

		expect(plannedFiles(plan)).toEqual(["a.ts", "b/{c,d}.ts"]);
	});

	it("plans nothing without a ## Files section", () => {
		expect(plannedFiles("# alpha\n")).toEqual([]);
	});
});
