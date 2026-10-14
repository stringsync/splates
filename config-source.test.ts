import { describe, expect, it } from "bun:test";
import { typedConfig, withoutSystems } from "./config-source";

describe("typedConfig", () => {
	it("swaps defineConfig for a type-only import and satisfies", () => {
		expect(
			typedConfig(`import { defineConfig } from "@webappwiz/arbor/config";

// Run before each merge.
export default defineConfig({
	preMerge: "echo ')'",
	trunk: "main",
});
`),
		).toBe(`import type { ConfigFile } from "@webappwiz/arbor/config";

// Run before each merge.
export default {
	preMerge: "echo ')'",
	trunk: "main",
} satisfies ConfigFile;
`);
	});

	it("rewrites nothing but a lone defineConfig imported alone", () => {
		expect(typedConfig(`export default { trunk: "main" };`)).toBeNull();
		expect(
			typedConfig(
				`import { defineConfig, type Config } from "@webappwiz/arbor/config";\nexport default defineConfig({});`,
			),
		).toBeNull();
		expect(
			typedConfig(
				`import { defineConfig } from "@webappwiz/arbor/config";\nconst a = defineConfig({});\nexport default defineConfig(a);`,
			),
		).toBeNull();
	});
});

describe("withoutSystems", () => {
	it("takes out the outermost systems, wherever it sits", () => {
		expect(
			withoutSystems(
				`export default defineConfig({ systems: { a: { globs: ["}"] } }, trunk: "main" });`,
			),
		).toBe(`export default defineConfig({ trunk: "main" });`);
		expect(
			withoutSystems(`export default { trunk: "main", "systems": {} };`),
		).toBe(`export default { trunk: "main", };`);
	});

	it("passes over systems in strings, comments, templates and nested objects", () => {
		const source = `// systems: old
export default {
	preMerge: \`echo \${"systems: {"}\`,
	hooks: { systems: 1 },
	systems: { a: { globs: ["a/**"] } },
};
`;

		expect(withoutSystems(source)).toBe(`// systems: old
export default {
	preMerge: \`echo \${"systems: {"}\`,
	hooks: { systems: 1 },
};
`);
	});

	it("finds nothing to take out of a config without exactly one", () => {
		expect(withoutSystems(`export default { trunk: "main" };`)).toBeNull();
		expect(withoutSystems(`export default { mySystems: {} };`)).toBeNull();
	});
});
