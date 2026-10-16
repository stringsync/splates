import { describe, expect, it } from "bun:test";
import { changedSections, skillHash } from "./sections";

describe("skill sections", () => {
	it("finds a section whose words changed, not one moved to another file unchanged", () => {
		const before = new Map([
			[
				"SKILL.md",
				"# Using arbor\n\nIntro.\n\n## Checkpoint\n\nStop.\n\n## Reporting\n\nSay so.\n",
			],
		]);
		const after = new Map([
			[
				"SKILL.md",
				"# Using arbor\n\nIntro.\n\n## Reporting\n\nSay so, briefly.\n",
			],
			["references/checkpoint.md", "## Checkpoint\n\nStop.\n"],
		]);
		expect(changedSections(before, after)).toEqual(["Reporting"]);
	});

	it("reads a heading inside a code block as part of its section", () => {
		const before = new Map([
			["SKILL.md", "## Reporting\n\n```markdown\n## ✅ Merged x\n```\n"],
		]);
		const after = new Map([
			["SKILL.md", "## Reporting\n\n```markdown\n## ✅ Merged y\n```\n"],
		]);
		expect(changedSections(before, after)).toEqual(["Reporting"]);
	});

	it("leaves the version ship stamps out of skillHash", () => {
		expect(
			skillHash(new Map([["SKILL.md", "---\nversion: 0.0.1\n---\nText"]])),
		).toBe(
			skillHash(new Map([["SKILL.md", "---\nversion: 0.0.2\n---\nText"]])),
		);
	});
});
