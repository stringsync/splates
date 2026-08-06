import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFs } from "@webappwiz/sys";
import { loadConfig } from "./config";

const fs = new NodeFs();

async function dir(files: Record<string, string>): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "arbor-config-"));
	for (const [name, content] of Object.entries(files)) {
		await fs.write(join(root, name), content);
	}
	return root;
}

test("worktrees default to a sibling of the repo, named after it", async () => {
	const root = await dir({});

	const config = await loadConfig(fs, root);

	expect(config.worktreeRoot).toBe(`${root}-arbor`);
	expect(config.trunk).toBe("main");
	await rm(root, { recursive: true, force: true });
});

test("a package.json test script becomes the default test command", async () => {
	const withScript = await dir({
		"package.json": JSON.stringify({ scripts: { test: "vitest" } }),
	});
	const without = await dir({ "package.json": "{}" });
	const unparseable = await dir({ "package.json": "{not json" });

	expect((await loadConfig(fs, withScript)).testCommand).toBe("bun run test");
	expect((await loadConfig(fs, without)).testCommand).toBe("bun test");
	expect((await loadConfig(fs, unparseable)).testCommand).toBe("bun test");

	for (const root of [withScript, without, unparseable]) {
		await rm(root, { recursive: true, force: true });
	}
});

test("arbor.config.ts overrides the defaults it names, and only those", async () => {
	const root = await dir({
		"arbor.config.ts": `export default { trunk: "trunk", graftRetryCount: 7 };\n`,
	});

	const config = await loadConfig(fs, root);

	expect(config.trunk).toBe("trunk");
	expect(config.graftRetryCount).toBe(7);
	expect(config.portRange).toEqual([3100, 3199]);
	await rm(root, { recursive: true, force: true });
});
