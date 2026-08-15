import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFs } from "@webappwiz/system";
import { loadConfig } from "./load-config";

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
		const config = await loadConfig(root, { fs: fs });

		expect(config.worktreeRoot).toBe(`${root}-arbor`);
		expect(config.trunk).toBe("main");
	});

	it("leaves every hook unset, so a repo runs only what it asks for", async () => {
		const config = await loadConfig(root, { fs: fs });

		expect(config.postCheckout).toBeNull();
		expect(config.postRewrite).toBeNull();
		expect(config.preMerge).toBeNull();
	});

	it("overrides only the defaults arbor.config.ts names", async () => {
		await fs.write(
			join(root, "arbor.config.ts"),
			`export default { trunk: "trunk", mergeRetryCount: 7 };\n`,
		);

		const config = await loadConfig(root, { fs: fs });

		expect(config.trunk).toBe("trunk");
		expect(config.mergeRetryCount).toBe(7);
		expect(config.leaseStalenessMs).toBe(90_000);
	});
});
