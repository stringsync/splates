import { expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { sandbox } from "./sandbox";

it("installs skill assets but keeps eval scenarios out of both copies", async () => {
	const root = await mkdtemp(join(tmpdir(), "eval-skill-test-"));
	try {
		const skill = join(root, "example");
		await mkdir(join(skill, "evals/nested"), { recursive: true });
		await mkdir(join(skill, "references"));
		await writeFile(join(skill, "SKILL.md"), "Instructions");
		await writeFile(join(skill, "references/guide.md"), "Guide");
		await writeFile(join(skill, "evals/nested/secret.ts"), "grading secret");
		const box = await sandbox(skill);
		try {
			const installedCopies = await Promise.all(
				[".agents", ".claude"].map(async (base) => {
					const installed = join(box.repo.dir, base, "skills/example");
					return {
						instructions: await readFile(join(installed, "SKILL.md"), "utf8"),
						guide: await readFile(
							join(installed, "references/guide.md"),
							"utf8",
						),
						exposed: await Bun.file(
							join(installed, "evals/nested/secret.ts"),
						).exists(),
					};
				}),
			);
			expect(installedCopies).toEqual([
				{ instructions: "Instructions", guide: "Guide", exposed: false },
				{ instructions: "Instructions", guide: "Guide", exposed: false },
			]);
			expect(await box.repo.run(["git", "ls-files"])).not.toContain(
				"secret.ts",
			);
		} finally {
			await box.remove();
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

it("points an inherited Playwright MCP at the run's own output directory", async () => {
	const skill = await mkdtemp(join(tmpdir(), "skill-"));
	await writeFile(join(skill, "SKILL.md"), "x");
	const box = await sandbox(skill);
	try {
		expect(box.env.PLAYWRIGHT_MCP_OUTPUT_DIR).toBe(
			join(dirname(box.repo.dir), "playwright"),
		);
		expect(box.env.PLAYWRIGHT_MCP_ALLOW_UNRESTRICTED_FILE_ACCESS).toBe("true");
	} finally {
		await box.remove();
		await rm(skill, { recursive: true, force: true });
	}
});
