import { describe, expect, it } from "bun:test";
import { withoutSystems } from "./config-source";

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
