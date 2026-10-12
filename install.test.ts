import { beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { FakeFs } from "webappwiz/system/testing";
import { install, SKILL_PATHS, versionOf } from "./install";
import { RUNNING } from "./release";
import { skill } from "./skill";

describe("install", () => {
	let fs: FakeFs;
	let log: MemoryLogger;

	beforeEach(() => {
		fs = new FakeFs();
		log = new MemoryLogger();
	});

	const run = () => install({ root: "/repo", fs, log });
	const said = () =>
		log.entries.map(({ message }) => String(message)).join("\n");

	it("writes the skill where every agent looks", async () => {
		await run();

		for (const path of SKILL_PATHS) {
			expect(await fs.read(`/repo/${path}`)).toEqual(skill);
		}
	});

	it("ships the skill at the version of the arbor it came with", () => {
		expect(versionOf(skill)).toEqual(RUNNING);
	});

	it("writes a newer skill over an older copy, saying which", async () => {
		await fs.write(
			"/repo/.agents/skills/arbor/SKILL.md",
			"---\nname: arbor\nversion: 0.0.1\n---\n",
		);

		await run();

		expect(await fs.read("/repo/.agents/skills/arbor/SKILL.md")).toEqual(skill);
		expect(said()).toContain(`0.0.1 to ${RUNNING}`);
	});

	it("leaves the agent instruction files alone", async () => {
		await fs.write("/repo/CLAUDE.md", "Run the tests.\n");

		await run();

		expect(await fs.read("/repo/CLAUDE.md")).toEqual("Run the tests.\n");
		expect(await fs.exists("/repo/AGENTS.md")).toBe(false);
	});

	it("changes nothing run a second time", async () => {
		await run();
		const before = await Promise.all(
			SKILL_PATHS.map((path) => fs.read(`/repo/${path}`)),
		);

		await run();

		expect(
			await Promise.all(SKILL_PATHS.map((path) => fs.read(`/repo/${path}`))),
		).toEqual(before);
		expect(said()).toContain(`already arbor ${RUNNING}`);
	});
});
