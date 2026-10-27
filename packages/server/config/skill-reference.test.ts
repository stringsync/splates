import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFs } from "webappwiz/system";
import { Git } from "../git";
import { FakeGitPs } from "../git-testing";
import { loadConfig } from "./load";

describe("the splates skill's config reference", () => {
	let root: string;
	let git: Git;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "splates-config-"));
		const ps = new FakeGitPs();
		// Stands in for a repo with no `origin/HEAD` to read.
		ps.simulate(() => Promise.resolve(1));
		git = new Git(root, { ps });
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it("names every option splates.config.ts can set, so an agent finds it without reading the code", async () => {
		const config = await loadConfig(root, { fs: new NodeFs(), git });
		const reference = await readFile(
			join(import.meta.dir, "../../../skills/splates/references/config.md"),
			"utf8",
		);

		const missing = Object.keys(config).filter(
			(option) => !reference.includes(`\`${option}\``),
		);

		expect(missing).toEqual([]);
	});
});
