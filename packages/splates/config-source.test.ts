import { describe, expect, it } from "bun:test";
import { typedConfig } from "./config-source";

describe("typedConfig", () => {
	it("swaps defineConfig for a type-only import and satisfies", () => {
		expect(
			typedConfig(`import { defineConfig } from "@stringsync/splates/config";

// Run before each merge.
export default defineConfig({
	preMerge: "echo ')'",
	trunk: "main",
});
`),
		).toBe(`import type { ConfigFile } from "@stringsync/splates/config";

// Run before each merge.
export default {
	preMerge: "echo ')'",
	trunk: "main",
} satisfies ConfigFile;
`);
	});

	it("still migrates a config using the unscoped package", () => {
		expect(
			typedConfig(
				'import { defineConfig } from "splates/config";\nexport default defineConfig({});',
			),
		).toBe(
			'import type { ConfigFile } from "@stringsync/splates/config";\nexport default {} satisfies ConfigFile;',
		);
	});

	it("rewrites nothing but a lone defineConfig imported alone", () => {
		expect(typedConfig(`export default { trunk: "main" };`)).toBeNull();
		expect(
			typedConfig(
				`import { defineConfig, type Config } from "@stringsync/splates/config";\nexport default defineConfig({});`,
			),
		).toBeNull();
		expect(
			typedConfig(
				`import { defineConfig } from "@stringsync/splates/config";\nconst a = defineConfig({});\nexport default defineConfig(a);`,
			),
		).toBeNull();
	});
});
