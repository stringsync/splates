import { describe, expect, test } from "bun:test";
import { FakeFs } from "core/system/testing";
import { BUNDLED_SKILL, installSkill, isUntouched, stamp } from "./skills";

const SOURCE = `${import.meta.dir}/../../skills/rec/SKILL.md`;
const SKILL = await Bun.file(SOURCE).text();

describe("rec skill", () => {
	test("the bundled copy is the skill source", async () => {
		expect(await Bun.file(BUNDLED_SKILL).text()).toBe(
			await Bun.file(SOURCE).text(),
		);
	});

	test("installs a stamped copy in both folders, then updates it", async () => {
		const fs = new FakeFs();
		const first = await installSkill(fs, SKILL, "/p", { force: false });
		expect(first).toEqual({
			ok: true,
			written: [
				"/p/.claude/skills/rec/SKILL.md",
				"/p/.agents/skills/rec/SKILL.md",
			],
		});
		const text = await fs.read("/p/.agents/skills/rec/SKILL.md");
		expect(text).toContain("version: ");
		expect(text).not.toContain("paths:");
		expect(isUntouched(text)).toBe(true);
		expect((await installSkill(fs, SKILL, "/p", { force: false })).ok).toBe(
			true,
		);
	});

	test("stops at a hand-edited file unless forced, writing nothing", async () => {
		const fs = new FakeFs();
		await installSkill(fs, SKILL, "/p", { force: false });
		await fs.write("/p/.agents/skills/rec/SKILL.md", "mine");
		const before = await fs.read("/p/.claude/skills/rec/SKILL.md");
		await fs.write("/p/.claude/skills/rec/SKILL.md", `${before}\nedit`);
		const stopped = await installSkill(fs, SKILL, "/p", { force: false });
		expect(stopped.ok).toBe(false);
		expect(await fs.read("/p/.agents/skills/rec/SKILL.md")).toBe("mine");
		expect((await installSkill(fs, SKILL, "/p", { force: true })).ok).toBe(
			true,
		);
		expect(isUntouched(await fs.read("/p/.agents/skills/rec/SKILL.md"))).toBe(
			true,
		);
	});

	test("stamp keeps the frontmatter closed", () => {
		expect(stamp('---\nname: rec\npaths: ["x"]\n---\nbody\n')).toMatch(
			/^---\nname: rec\nversion: [0-9a-f]+\n---\nbody\n$/,
		);
	});
});
