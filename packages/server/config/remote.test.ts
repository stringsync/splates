import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFs } from "webappwiz/system";
import { Git } from "../git";
import { loadConfig } from "./load";

describe("loadConfig's remote", () => {
	const fs = new NodeFs();
	let root: string;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "splates-config-"));
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	function originAt(url: string | null): Git {
		const origin = new Git(root);
		origin.defaultBranch = () => Promise.resolve(null);
		origin.remoteUrl = () => Promise.resolve(url);
		return origin;
	}

	it("stays null when unset", async () => {
		const config = await loadConfig(root, {
			fs,
			git: originAt("git@github.com:o/r.git"),
		});

		expect(config.remote).toBeNull();
	});

	it("stays null for an HTTPS origin", async () => {
		const config = await loadConfig(root, {
			fs,
			git: originAt("https://github.com/o/r.git"),
		});

		expect(config.remote).toBeNull();
	});

	it("stays null when the config says null", async () => {
		await fs.write(
			join(root, "splates.config.ts"),
			"export default { remote: null };\n",
		);

		const config = await loadConfig(root, {
			fs,
			git: originAt("git@github.com:o/r.git"),
		});

		expect(config.remote).toBeNull();
	});
});
