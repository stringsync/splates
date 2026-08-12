import { describe, expect, it } from "bun:test";
import { progress } from "./progress";

const plan = (...lines: string[]): string => `${lines.join("\n")}\n`;

describe("progress", () => {
	it("counts the ticked boxes against every box in Done and Next", () => {
		expect(
			progress(
				plan(
					"# alpha",
					"",
					"## Done",
					"- [x] one",
					"- [x] two",
					"",
					"## Next",
					"- [ ] three",
					"- [ ] four",
				),
			),
		).toEqual({ done: 2, total: 4 });
	});

	it("ignores a checklist outside the sections that hold the work", () => {
		expect(
			progress(
				plan(
					"# alpha",
					"",
					"## Next",
					"- [ ] the rest",
					"",
					"## Notes",
					"- [ ] a stray box here must not count",
				),
			),
		).toEqual({ done: 0, total: 1 });
	});

	it("reports nothing to count when the file has no checklist", () => {
		expect(progress(plan("# alpha", "", "## Goal", "land it"))).toBeNull();
	});

	it("reports nothing to count when neither section is there at all", () => {
		expect(progress(plan("- [x] a box under no heading"))).toBeNull();
	});

	it("counts an upper-case X as ticked, the way the CLI does", () => {
		expect(
			progress(plan("## Done", "- [X] one", "", "## Next", "- [ ] two")),
		).toEqual({ done: 1, total: 2 });
	});
});
