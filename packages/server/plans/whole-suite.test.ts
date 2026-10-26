import { describe, expect, it } from "bun:test";
import { isWholeSuite } from "./run-command";

describe("isWholeSuite", () => {
	it("knows an unscoped dev test or premerge, however splates is run", () => {
		expect(
			[
				"splates dev test",
				"bin/splates dev test --ci --workers 4",
				"./bin/splates dev premerge",
				"bunx @stringsync/splates dev test --all",
				"SPLATES_ROOT=/x bin/splates dev premerge --all",
			].map(isWholeSuite),
		).toEqual([true, true, true, true, true]);
	});

	it("grants scoped test runs too, but passes over evals and other commands", () => {
		expect(
			[
				"splates dev test --changed",
				"bin/splates dev test --since=main",
				"bin/splates dev test --since main",
				"bin/splates dev test --test-name-pattern merge",
				"bin/splates dev test packages/web/thread.test.tsx",
				"bin/splates dev test --evals",
				"bin/splates dev premerge --evals",
				"bin/splates dev fix",
				"bun test",
			].map(isWholeSuite),
		).toEqual([true, true, true, true, true, false, false, false, false]);
	});
});
