import { expect, test } from "bun:test";
import { view } from "core/ship";
import { stampSkill } from "./dev/stamp";
import { splatesShip } from "./ship";

test("splates ships to npm through its mirror, at the bump asked for", () => {
	const plan = view(splatesShip, { bump: "minor" });
	expect(plan.name).toBe("@stringsync/splates");
	expect(plan.bump).toBe("minor");
	expect(plan.dependencies).toEqual([]);
	expect(plan.steps.map((each) => each.id)).toEqual([
		"login",
		"test",
		"version",
		"workflow",
		"mirror",
		"first-publish",
		"trust",
		"publish",
		"tag",
	]);
});

test("the skill is stamped at the release's version, its body untouched", () => {
	const doc = "---\nname: splates\nversion: 2.0.11\n---\n\nversion: kept\n";
	expect(stampSkill(doc, "2.1.0")).toBe(
		"---\nname: splates\nversion: 2.1.0\n---\n\nversion: kept\n",
	);
});

test("a skill with no version to stamp is refused", () => {
	expect(() => stampSkill("---\nname: splates\n---\n", "2.1.0")).toThrow(
		'no "version:" line',
	);
});

test("splates counts unshipped commits since its newest release tag", async () => {
	const commands: string[] = [];
	const count = await splatesShip.unshipped?.({
		sh: async (command: string) => {
			commands.push(command);
			return "5\n";
		},
	});
	expect(count).toBe(5);
	expect(commands[0]).toContain("'refs/tags/@stringsync/splates@*'");
	expect(commands[0]).toContain(
		"'splates/packages/splates' 'splates/packages/server' 'splates/packages/web'",
	);
	expect(commands[0]).toContain("'core/packages/core'");
});
