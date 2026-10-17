import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readlink, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryLogger } from "webappwiz/log";
import { NodeFs, NodePs } from "webappwiz/system";
import {
	legacyName,
	movedPath,
	moveLegacyDir,
	movePlan,
	removeLegacySkill,
	renamed,
	renameLegacyFiles,
	unmigrated,
} from "./legacy-names";

describe("legacy names", () => {
	const fs = new NodeFs();
	let root: string;
	let log: MemoryLogger;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "splates-legacy-"));
		log = new MemoryLogger();
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it("names a variable or cred both ways, and leaves others alone", () => {
		expect([
			legacyName("SPLATES_HOME"),
			renamed("ARBOR_CLOUDFLARE_API_TOKEN"),
			legacyName("HOME"),
			renamed("HOME"),
		]).toEqual(["ARBOR_HOME", "SPLATES_CLOUDFLARE_API_TOKEN", null, null]);
	});

	it("moves arbor's directory and leaves a link, so old paths still resolve", async () => {
		await fs.mkdir(join(root, "arbor", "tasks"));
		await fs.write(join(root, "arbor", "tasks", "a.json"), "{}");

		const moved = await moveLegacyDir(
			join(root, "arbor"),
			join(root, "splates"),
			{
				fs,
				log,
			},
		);

		expect({
			moved,
			link: await readlink(join(root, "arbor")),
			read: await fs.read(join(root, "arbor", "tasks", "a.json")),
			at: await fs.exists(join(root, "splates", "tasks", "a.json")),
		}).toEqual({ moved: true, link: "splates", read: "{}", at: true });
	});

	it("leaves both directories alone once splates has its own", async () => {
		await fs.mkdir(join(root, "arbor"));
		await fs.mkdir(join(root, "splates"));
		await fs.write(join(root, "arbor", "old"), "");
		await fs.write(join(root, "splates", "new"), "");

		const moved = await moveLegacyDir(
			join(root, "arbor"),
			join(root, "splates"),
			{
				fs,
				log,
			},
		);

		expect({
			moved,
			old: await fs.isSymlink(join(root, "arbor")),
			kept: await fs.exists(join(root, "arbor", "old")),
		}).toEqual({ moved: false, old: false, kept: true });
	});

	it("reads arbor's directory until it is moved", async () => {
		await fs.mkdir(join(root, "arbor"));

		expect(unmigrated(join(root, "splates"), join(root, "arbor"))).toBe(
			join(root, "arbor"),
		);
	});

	it("reads splates's directory when neither is there yet", () => {
		expect(unmigrated(join(root, "splates"), join(root, "arbor"))).toBe(
			join(root, "splates"),
		);
	});

	it("names an attachment under .git/splates when its path is under .git/arbor", () => {
		expect(movedPath("/repo/.git/arbor/tasks/a/1-shot.png")).toBe(
			"/repo/.git/splates/tasks/a/1-shot.png",
		);
	});

	it("renames a worktree's ARBOR.md unless it has a SPLATES.md", async () => {
		await fs.write(join(root, "ARBOR.md"), "# task");

		await movePlan(root, "SPLATES.md", fs);

		expect({
			plan: await fs.read(join(root, "SPLATES.md")),
			old: await fs.exists(join(root, "ARBOR.md")),
		}).toEqual({ plan: "# task", old: false });
	});

	it("renames arbor's config files and points their imports at splates", async () => {
		await fs.write(
			join(root, "arbor.config.ts"),
			'import type { ConfigFile } from "@webappwiz/arbor/config";\nexport default {} satisfies ConfigFile;\n',
		);
		await fs.write(join(root, "arbor.systems.ts"), "export default {};\n");

		await renameLegacyFiles({ root, fs, ps: new NodePs(), log });

		expect({
			config: await fs.read(join(root, "splates.config.ts")),
			systems: await fs.exists(join(root, "splates.systems.ts")),
			old: await fs.exists(join(root, "arbor.config.ts")),
		}).toEqual({
			config:
				'import type { ConfigFile } from "@stringsync/splates/config";\nexport default {} satisfies ConfigFile;\n',
			systems: true,
			old: false,
		});
	});

	it("removes arbor's installed skill", async () => {
		await fs.mkdir(join(root, "arbor"));
		await fs.write(join(root, "arbor", "SKILL.md"), "---\nname: arbor\n---\n");

		await removeLegacySkill(join(root, "arbor"), { fs, log });

		expect(await fs.exists(join(root, "arbor"))).toBe(false);
	});

	it("leaves an arbor skill that links to a copy kept by hand", async () => {
		await fs.mkdir(join(root, "kept"));
		await fs.write(join(root, "kept", "SKILL.md"), "");
		await symlink("kept", join(root, "arbor"));

		await removeLegacySkill(join(root, "arbor"), { fs, log });

		expect(await fs.isSymlink(join(root, "arbor"))).toBe(true);
	});
});
