import { expect, test } from "bun:test";
import { areasOf } from "./areas";

test("a file in a package is named by its file, tests with it", () => {
	expect(
		areasOf([
			"splates/packages/web/task-dialog.tsx",
			"splates/packages/web/task-dialog.test.tsx",
			"splates/packages/web/tag-chips.tsx",
		]),
	).toEqual(["task dialog", "tag chips"]);
});

test("a folder in a package names the area, and a skill is skill", () => {
	expect(
		areasOf([
			"splates/packages/server/tasks/add.ts",
			"splates/packages/server/tasks/show.ts",
			"splates/skills/splates/SKILL.md",
			"splates/skills/splates/references/queue.md",
		]),
	).toEqual(["skill", "tasks"]);
});

test("SPLATES.md is no area, and other paths name their top folder", () => {
	expect(areasOf(["SPLATES.md", "bin/mono", "package.json"])).toEqual([
		"bin",
		"root",
	]);
});
