import { beforeAll, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { SCENARIOS } from "./scenarios";
import { sections } from "./sections";
import { variant } from "./variants";

describe("the scenarios' sections", () => {
	let headings: Set<string>;

	beforeAll(async () => {
		const repo = join(import.meta.dir, "../..");
		const skill = await variant(join(repo, "skills/arbor"), { repo });
		headings = new Set(sections(skill.files).keys());
	});

	it("are each a heading in the skill, so a change to it reruns them", () => {
		const missing = SCENARIOS.flatMap((scenario) =>
			scenario.sections
				.filter((heading) => !headings.has(heading))
				.map((heading) => `${scenario.id}: ${heading}`),
		);
		expect(missing).toEqual([]);
	});
});
