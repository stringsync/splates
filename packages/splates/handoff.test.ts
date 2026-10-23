import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkoutAbove, handOffDev } from "./handoff";

/** A fresh directory, removed when the test lets go of it. */
function temp(prefix: string) {
	const path = mkdtempSync(join(tmpdir(), prefix));
	return {
		path,
		[Symbol.dispose]: () => rmSync(path, { recursive: true, force: true }),
	};
}

test("finds, from checkoutAbove, the checkout a directory is inside", () => {
	using root = temp("handoff-");
	using outside = temp("outside-");
	mkdirSync(join(root.path, "bin"));
	mkdirSync(join(root.path, "packages", "splates"), { recursive: true });
	writeFileSync(join(root.path, "bin", "splates"), "");
	writeFileSync(join(root.path, "packages", "splates", "checkout.ts"), "");
	expect(checkoutAbove(join(root.path, "packages"))).toBe(root.path);
	expect(checkoutAbove(outside.path)).toBeNull();
});

test("fails, from handOffDev, outside a checkout and ignores other commands", async () => {
	using outside = temp("outside-");
	expect(await handOffDev(["dev", "test"], outside.path)).toBe(1);
	expect(await handOffDev(["list"], outside.path)).toBeNull();
});
