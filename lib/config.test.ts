import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFs } from "@webappwiz/sys";
import { loadConfig } from "./config";

describe("loadConfig", () => {
	const fs = new NodeFs();
	let root: string;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "arbor-config-"));
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it("defaults the worktree root to a sibling of the repo, named after it", async () => {
		const config = await loadConfig(fs, root);

		expect(config.worktreeRoot).toBe(`${root}-arbor`);
		expect(config.trunk).toBe("main");
	});

	it("takes the default test command from a package.json test script", async () => {
		const packageJson = join(root, "package.json");

		await fs.write(
			packageJson,
			JSON.stringify({ scripts: { test: "vitest" } }),
		);
		expect((await loadConfig(fs, root)).testCommand).toBe("bun run test");

		await fs.write(packageJson, "{}");
		expect((await loadConfig(fs, root)).testCommand).toBe("bun test");

		await fs.write(packageJson, "{not json");
		expect((await loadConfig(fs, root)).testCommand).toBe("bun test");
	});

	it("overrides only the defaults arbor.config.ts names", async () => {
		await fs.write(
			join(root, "arbor.config.ts"),
			`export default { trunk: "trunk", graftRetryCount: 7 };\n`,
		);

		const config = await loadConfig(fs, root);

		expect(config.trunk).toBe("trunk");
		expect(config.graftRetryCount).toBe(7);
		expect(config.leaseStalenessMs).toBe(90_000);
	});
});
