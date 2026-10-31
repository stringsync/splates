import { expect, it } from "bun:test";
import { runsWholeSuite } from "./resources";

it("tells a whole-suite run from a scoped one", () => {
	expect(
		[
			"bun test",
			"bun test 2>&1 | tail -40",
			"cd x && bun test --timeout 30000",
			"npm test",
			"bun run test",
			"bun test src/math.test.ts",
			"bun test --changed 2>&1 | tail -40",
			"bun install",
			"git status",
		].map(runsWholeSuite),
	).toEqual([true, true, true, true, true, false, false, false, false]);
});
