import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import { Git, type GitRunner } from "@stringsync/splates-server/git";
import { FakeFs } from "webappwiz/system/testing";
import { TestScope } from "./test-scope";

describe("test scope preflight", () => {
	it.each([undefined, "", "main"])(
		"counts changed tests against the expected revision for since=%j",
		async (since) => {
			const { scope, ps } = await fixture();
			expect(await scope.count({ changed: true, since })).toEqual({
				selected: 2,
				total: 3,
			});
			expect(ps.diffArgs).toEqual([
				"--no-optional-locks",
				"diff",
				"--name-only",
				"-z",
				since || "HEAD",
				"--",
			]);
		},
	);

	it("follows transitive imports and keeps the whole-suite denominator", async () => {
		const { scope } = await fixture();
		expect(await scope.count({ since: "main" })).toEqual({
			selected: 2,
			total: 3,
		});
		expect(await scope.count({ changed: true, files: ["a.test.ts"] })).toEqual({
			selected: 1,
			total: 3,
		});
	});

	it("counts path filters and includes evals only for --all", async () => {
		const { scope } = await fixture();
		expect(await scope.count({ files: ["c.test.ts"] })).toEqual({
			selected: 1,
			total: 3,
		});
		expect(await scope.count({ all: true })).toEqual({ selected: 4, total: 4 });
	});
	it("counts unresolved imports conservatively without counting unrelated tests", async () => {
		const { scope, fs, ps } = await fixture();
		ps.changed = "unrelated.ts";
		await fs.write("/repo/shared.ts", 'import "./missing";');
		expect(await scope.count({ changed: true })).toEqual({
			selected: 2,
			total: 3,
		});
	});

	it("treats configuration changes as potentially reaching every filtered file", async () => {
		const { scope, ps } = await fixture();
		ps.changed = "bunfig.toml";
		expect(await scope.count({ changed: true })).toEqual({
			selected: 3,
			total: 3,
		});
		expect(await scope.count({ changed: true, files: ["c.test.ts"] })).toEqual({
			selected: 1,
			total: 3,
		});
	});

	it("includes untracked changes and uses the TypeScript loader for generic arrow functions", async () => {
		const { scope, ps } = await fixture();
		ps.changed = "";
		ps.untracked = "shared.ts";
		expect(await scope.count({ changed: true })).toEqual({
			selected: 2,
			total: 3,
		});
		ps.untracked = "";
		expect(await scope.count({ changed: true })).toEqual({
			selected: 0,
			total: 3,
		});
	});
});

class ScopeGit implements GitRunner {
	changed = "shared.ts";
	untracked = "";
	diffArgs: string[] = [];
	async git(_cwd: string, argv: string[]) {
		if (argv.includes("diff")) {
			this.diffArgs = argv;
		}
		return {
			code: 0,
			stdout: argv.includes("diff")
				? `${this.changed}\0`
				: argv.includes("--cached")
					? "shared.ts\0bridge.ts\0a.test.ts\0b.test.ts\0c.test.ts\0evals/d.test.ts\0"
					: `${this.untracked}\0`,
			stderr: "",
		};
	}
}

async function fixture() {
	const fs = new FakeFs();
	for (const [file, source] of Object.entries({
		"shared.ts": "export const value = <T>(x: T) => x;",
		"bridge.ts": 'export { value } from "./shared";',
		"a.test.ts": 'import {value} from "./bridge";',
		"b.test.ts": 'import {value} from "./shared";',
		"c.test.ts": "",
		"evals/d.test.ts": "",
	})) {
		await fs.write(`/repo/${file}`, source);
	}
	const ps = new ScopeGit();
	return {
		fs,
		ps,
		scope: new TestScope(new Git("/repo", { run: ps }), fs, (path, dir) =>
			resolve(dir, `${path}.ts`),
		),
	};
}
