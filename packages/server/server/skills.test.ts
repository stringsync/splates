import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { versionOf } from "core/skills";

describe("the splates skill", () => {
	it("ships at the version of the splates it came with", async () => {
		const skill = await Bun.file(
			join(import.meta.dir, "../../../skills/splates/SKILL.md"),
		).text();
		// The published package's own manifest: a ship stamps it and the skill
		// alike, where the server's private manifest keeps its checkout version.
		const manifest = await Bun.file(
			join(import.meta.dir, "../../splates/package.json"),
		).json();

		expect(versionOf(skill)).toEqual(manifest.version);
	});
});
