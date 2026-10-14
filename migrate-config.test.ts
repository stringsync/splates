import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryLogger } from "webappwiz/log";
import { NodeFs } from "webappwiz/system";
import { importConfig } from "./load-config";
import { moveSystems, systemsSource, typeConfig } from "./migrate-config";
import { Systems } from "./systems";

describe("moveSystems", () => {
	const fs = new NodeFs();
	let root: string;
	let log: MemoryLogger;

	beforeEach(async () => {
		// Imported from disk, so a real directory.
		root = await mkdtemp(join(tmpdir(), "arbor-move-systems-"));
		log = new MemoryLogger();
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	const config = () => fs.read(join(root, "arbor.config.ts"));
	const move = () => moveSystems({ root, fs, log });

	it("moves the systems into arbor.systems.ts and out of the config, keeping the rest", async () => {
		await fs.write(
			join(root, "arbor.config.ts"),
			`export default {
	preMerge: "bun test",
	// What the code is made of.
	systems: {
		docs: { aliases: ["manual"], globs: ["docs/**", "*.md"] },
		mixer: {
			globs: ["src/mixer/**"], // the bus too
			ignore: ["src/mixer/**/*.test.ts"],
		},
	},
	trunk: "main",
};
`,
		);

		expect(await move()).toBe(0);

		expect(await config()).toBe(`export default {
	preMerge: "bun test",
	// What the code is made of.
	trunk: "main",
};
`);
		expect(await fs.read(join(root, "arbor.systems.ts"))).toBe(
			systemsSource({
				docs: { aliases: ["manual"], globs: ["docs/**", "*.md"] },
				mixer: {
					globs: ["src/mixer/**"],
					ignore: ["src/mixer/**/*.test.ts"],
				},
			}),
		);
		expect(
			(await Systems.at(root, { fs })).all().map((each) => each.name),
		).toEqual(["docs", "mixer"]);
	});

	it("does nothing when the config names no systems", async () => {
		const before = `export default { preMerge: "true" };\n`;
		await fs.write(join(root, "arbor.config.ts"), before);

		expect(await move()).toBe(0);

		expect(await config()).toBe(before);
		expect(await fs.exists(join(root, "arbor.systems.ts"))).toBe(false);
	});

	it("does nothing when there is no config", async () => {
		expect(await move()).toBe(0);

		expect(await fs.exists(join(root, "arbor.systems.ts"))).toBe(false);
	});

	it("leaves both files alone when both name systems", async () => {
		const before = `export default { systems: { docs: { globs: ["*.md"] } } };\n`;
		await fs.write(join(root, "arbor.config.ts"), before);
		await fs.write(join(root, "arbor.systems.ts"), "export default {};\n");

		expect(await move()).toBe(1);

		expect(await config()).toBe(before);
		expect(await fs.read(join(root, "arbor.systems.ts"))).toBe(
			"export default {};\n",
		);
		expect(String(log.entries.at(-1)?.message)).toContain("by hand");
	});

	it("leaves the config alone when it names systems it cannot find in the source", async () => {
		const before = `const systems = { docs: { globs: ["*.md"] } };\nexport default { systems };\n`;
		await fs.write(join(root, "arbor.config.ts"), before);

		expect(await move()).toBe(1);

		expect(await config()).toBe(before);
		expect(await fs.exists(join(root, "arbor.systems.ts"))).toBe(false);
	});
});

describe("typeConfig", () => {
	const fs = new NodeFs();
	let root: string;
	let log: MemoryLogger;

	beforeEach(async () => {
		// Imported from disk, and inside this package, so a config's import of
		// `@webappwiz/arbor/config` resolves as in a repo that installs arbor.
		root = await mkdtemp(join(import.meta.dirname, ".type-config-"));
		log = new MemoryLogger();
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	const config = () => fs.read(join(root, "arbor.config.ts"));

	it("types a config that calls defineConfig with satisfies, keeping what it names", async () => {
		await fs.write(
			join(root, "arbor.config.ts"),
			`import { defineConfig } from "@webappwiz/arbor/config";

export default defineConfig({
	preMerge: "bun test",
});
`,
		);

		await typeConfig({ root, fs, log });

		expect(
			await config(),
		).toBe(`import type { ConfigFile } from "@webappwiz/arbor/config";

export default {
	preMerge: "bun test",
} satisfies ConfigFile;
`);
		expect(await importConfig(root, fs)).toEqual({ preMerge: "bun test" });
	});

	it("leaves a config it cannot rewrite as it is, saying so", async () => {
		const before = `import { defineConfig as d } from "@webappwiz/arbor/config";\nexport default d({});\n`;
		await fs.write(join(root, "arbor.config.ts"), before);

		await typeConfig({ root, fs, log });

		expect(await config()).toBe(before);
	});

	it("leaves a config already typed, or none, alone", async () => {
		await typeConfig({ root, fs, log });
		expect(await fs.exists(join(root, "arbor.config.ts"))).toBe(false);

		const typed = `export default { trunk: "main" };\n`;
		await fs.write(join(root, "arbor.config.ts"), typed);
		await typeConfig({ root, fs, log });

		expect(await config()).toBe(typed);
		expect(log.entries).toEqual([]);
	});
});

describe("systemsSource", () => {
	it("types the systems by a type-only import, with keys unquoted where they can be", () => {
		expect(
			systemsSource({
				docs: { aliases: ["the manual"], globs: ["*.md"] },
				"web-app": { globs: ["web/**"] },
			}),
		).toBe(`import type { SystemsFile } from "@webappwiz/arbor/systems";

export default {
	docs: {
		aliases: [
			"the manual"
		],
		globs: [
			"*.md"
		]
	},
	"web-app": {
		globs: [
			"web/**"
		]
	}
} satisfies SystemsFile;
`);
	});
});
