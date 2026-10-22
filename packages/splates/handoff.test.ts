import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkoutAbove, handOffDev } from "./handoff";

test("checkoutAbove finds the checkout a directory is inside", () => {
	const root = mkdtempSync(join(tmpdir(), "handoff-"));
	mkdirSync(join(root, "bin"));
	mkdirSync(join(root, "packages", "splates"), { recursive: true });
	writeFileSync(join(root, "bin", "splates"), "");
	writeFileSync(join(root, "packages", "splates", "checkout.ts"), "");
	expect(checkoutAbove(join(root, "packages"))).toBe(root);
	expect(checkoutAbove(mkdtempSync(join(tmpdir(), "outside-")))).toBeNull();
});

test("handOffDev fails outside a checkout and ignores other commands", async () => {
	const outside = mkdtempSync(join(tmpdir(), "outside-"));
	expect(await handOffDev(["dev", "test"], outside)).toBe(1);
	expect(await handOffDev(["list"], outside)).toBeNull();
});
