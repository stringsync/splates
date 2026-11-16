import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { revisionOf } from "./revision";

describe("revisionOf", () => {
	let skill: string;

	beforeEach(async () => {
		skill = await mkdtemp(join(tmpdir(), "eval-revision-"));
		await mkdir(join(skill, "evals"));
		await writeFile(join(skill, "SKILL.md"), "skill\n");
		await writeFile(
			join(skill, "evals", "a.ts"),
			"export const scenarios = [];\n",
		);
	});

	afterEach(() => rm(skill, { recursive: true, force: true }));

	it("hashes the scenarios when evals holds a symlinked node_modules", async () => {
		const plain = await revisionOf(skill);
		await mkdir(join(skill, "evals", "node_modules"));
		await symlink(tmpdir(), join(skill, "evals", "node_modules", "linked"));
		expect((await revisionOf(skill)).scenarioHash).toBe(plain.scenarioHash);
	});

	it("changes only the scenario hash when a scenario file changes", async () => {
		const before = await revisionOf(skill);
		await writeFile(
			join(skill, "evals", "a.ts"),
			"export const scenarios = [1];\n",
		);
		const after = await revisionOf(skill);
		expect(after.scenarioHash).not.toBe(before.scenarioHash);
		expect(after.skillHash).toBe(before.skillHash);
	});

	it("changes only the skill hash when the skill changes", async () => {
		const before = await revisionOf(skill);
		await writeFile(join(skill, "SKILL.md"), "changed\n");
		const after = await revisionOf(skill);
		expect(after.skillHash).not.toBe(before.skillHash);
		expect(after.scenarioHash).toBe(before.scenarioHash);
	});
});
