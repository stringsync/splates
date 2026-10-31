import { describe, expect, it } from "bun:test";
import { isWholeSuite } from "./run-command";

describe("isWholeSuite", () => {
	it("knows an unscoped test or premerge, however it is run", () => {
		expect(
			[
				"bin/mono test",
				"./bin/mono test --all",
				"bin/mono premerge",
				"bun run premerge",
				"FOO=1 bin/mono premerge --all",
			].map(isWholeSuite),
		).toEqual([true, true, true, true, true]);
	});

	it("grants scoped test runs too, but passes over evals and other commands", () => {
		expect(
			[
				"bin/mono test --since main",
				"bin/mono test packages/web/thread.test.tsx",
				"bin/mono test --evals",
				"bin/mono premerge --evals",
				"bin/mono fix",
				"splates dev test",
				"bun test",
			].map(isWholeSuite),
		).toEqual([true, true, false, false, false, false, false]);
	});
});
