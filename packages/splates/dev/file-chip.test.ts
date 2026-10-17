import { describe, expect, it } from "bun:test";
import { distinctNames } from "./file-chip";

describe("distinctNames", () => {
	it("calls each by its own name, a directory's with its slash", () => {
		expect([...distinctNames(["src/a.ts", "src/lib/"])]).toEqual([
			["src/a.ts", "a.ts"],
			["src/lib/", "lib/"],
		]);
	});

	it("takes in the directories above those that share a name until they differ", () => {
		expect([
			...distinctNames([
				"app/ui/index.ts",
				"server/ui/index.ts",
				"index.ts",
				"src/a.ts",
				"app/ui/",
				"lib/ui/",
			]),
		]).toEqual([
			["app/ui/index.ts", "app/ui/index.ts"],
			["server/ui/index.ts", "server/ui/index.ts"],
			["index.ts", "index.ts"],
			["src/a.ts", "a.ts"],
			["app/ui/", "app/ui/"],
			["lib/ui/", "lib/ui/"],
		]);
	});

	it("names a path given twice once", () => {
		expect([...distinctNames(["src/a.ts", "src/a.ts"])]).toEqual([
			["src/a.ts", "a.ts"],
		]);
	});
});
