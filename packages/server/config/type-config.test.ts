import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { MemoryLogger } from "webappwiz/log";
import { NodeFs } from "webappwiz/system";
import { ConfigFiles } from "./load";
import { typeConfig } from "./type-config";

describe("typeConfig", () => {
	const fs = new NodeFs();
	let root: string;
	let log: MemoryLogger;

	beforeEach(async () => {
		// Imported from disk, and inside this package, so a config's import of
		// `@stringsync/splates-server/config` resolves as in a repo that installs splates.
		root = await mkdtemp(join(import.meta.dirname, ".type-config-"));
		log = new MemoryLogger();
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	const config = () => fs.read(join(root, "splates.config.ts"));

	it("types a config that calls defineConfig with satisfies, keeping what it names", async () => {
		await fs.write(
			join(root, "splates.config.ts"),
			`import { defineConfig } from "@stringsync/splates-server/config";

export default defineConfig({
	preMerge: "bun test",
});
`,
		);

		await typeConfig({ root, fs, log });

		expect(
			await config(),
		).toBe(`import type { ConfigFile } from "@stringsync/splates-server/config";

export default {
	preMerge: "bun test",
} satisfies ConfigFile;
`);
		expect(await new ConfigFiles(fs).importConfig(root)).toEqual({
			preMerge: "bun test",
		});
	});

	it("leaves a config it cannot rewrite as it is, saying so", async () => {
		const before = `import { defineConfig as d } from "@stringsync/splates-server/config";\nexport default d({});\n`;
		await fs.write(join(root, "splates.config.ts"), before);

		await typeConfig({ root, fs, log });

		expect(await config()).toBe(before);
	});

	it("leaves a config already typed, or none, alone", async () => {
		await typeConfig({ root, fs, log });
		expect(await fs.exists(join(root, "splates.config.ts"))).toBe(false);

		const typed = `export default { trunk: "main" };\n`;
		await fs.write(join(root, "splates.config.ts"), typed);
		await typeConfig({ root, fs, log });

		expect(await config()).toBe(typed);
		expect(log.entries).toEqual([]);
	});
});
