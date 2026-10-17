import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { versionOf } from "webappwiz/skills";
import { RUNNING } from "./release";

describe("the arbor skill", () => {
	it("ships at the version of the arbor it came with", async () => {
		const skill = await Bun.file(
			join(import.meta.dir, "../../skills/arbor/SKILL.md"),
		).text();

		expect(versionOf(skill)).toEqual(RUNNING);
	});
});
