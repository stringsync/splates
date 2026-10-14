import { beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { MemoryLogger } from "webappwiz/log";
import { FakeFs, FakePs } from "webappwiz/system/testing";
import { RUNNING } from "./release";
import { ProjectSkills, versionOf } from "./skills";

describe("ProjectSkills", () => {
	let fs: FakeFs;
	let ps: FakePs;
	let log: MemoryLogger;
	let skills: ProjectSkills;

	beforeEach(() => {
		fs = new FakeFs();
		ps = new FakePs();
		log = new MemoryLogger();
		skills = new ProjectSkills("/repo", { fs, ps, log });
	});

	const said = () =>
		log.entries.map(({ message }) => String(message)).join("\n");
	const copy = async (name: string, version: string) => {
		await fs.mkdir(`/repo/.agents/skills/${name}`);
		await fs.write(
			`/repo/.agents/skills/${name}/SKILL.md`,
			`---\nname: ${name}\nversion: ${version}\n---\n`,
		);
	};

	it("installs each skill from the release's tag, in the project", async () => {
		await skills.add(["arbor", "scry"], "1.2.3");

		expect(ps.getCalls()).toEqual([
			"bunx skills@1 add jaredjj3/webappwiz#v1.2.3 --yes --skill arbor scry",
		]);
		expect(ps.getCallDirs()).toEqual(["/repo"]);
	});

	it("installs over an older copy, saying from which release", async () => {
		await copy("arbor", "1.0.0");

		await skills.add(["arbor"], "1.2.3");

		expect(ps.getCalls()).toHaveLength(1);
		expect(said()).toContain("arbor 1.0.0 to 1.2.3");
	});

	it("runs nothing for a copy already at the release", async () => {
		await copy("arbor", "1.2.3");

		await skills.add(["arbor"], "1.2.3");

		expect(ps.getCalls()).toEqual([]);
		expect(said()).toContain("already arbor 1.2.3");
	});

	it("leaves a copy that links to one kept by hand", async () => {
		await fs.write("/repo/skills/arbor/SKILL.md", "---\nversion: 0.0.1\n---\n");
		await fs.symlink(
			"../../../skills/arbor/SKILL.md",
			"/repo/.agents/skills/arbor/SKILL.md",
		);

		await skills.add(["arbor", "scry"], "1.2.3");

		expect(ps.getCalls()).toEqual([
			"bunx skills@1 add jaredjj3/webappwiz#v1.2.3 --yes --skill scry",
		]);
		expect(said()).toContain(".agents/skills/arbor links to your own copy");
	});

	it("leaves a skill whose whole directory is a link", async () => {
		await fs.write("/elsewhere/arbor/SKILL.md", "---\nversion: 0.0.1\n---\n");
		await fs.symlink("/elsewhere/arbor", "/repo/.agents/skills/arbor");

		await skills.add(["arbor"], "1.2.3");

		expect(ps.getCalls()).toEqual([]);
	});

	it("throws when skills fails", async () => {
		ps.simulate(async () => 1);

		expect(skills.add(["arbor"], "1.2.3")).rejects.toThrow("exited 1");
	});

	it("lists what the project has, and from which release", async () => {
		await copy("scry", "1.0.0");
		await copy("arbor", "1.2.3");
		await fs.mkdir("/repo/.agents/skills/empty");

		expect(await skills.installed()).toEqual(["arbor", "scry"]);
		expect(await skills.version("scry")).toBe("1.0.0");
		expect(await skills.version("missing")).toBeNull();
	});

	it("ships the arbor skill at the version of the arbor it came with", async () => {
		const skill = await Bun.file(
			join(import.meta.dir, "../../skills/arbor/SKILL.md"),
		).text();

		expect(versionOf(skill)).toEqual(RUNNING);
	});
});
