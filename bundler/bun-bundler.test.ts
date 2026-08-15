import { describe, expect, it } from "bun:test";
import { BunBundler } from "./bun-bundler";

describe("BunBundler", () => {
	it("bundles a module into a script", async () => {
		const script = await new BunBundler().bundle(
			`${import.meta.dirname}/bun-bundler.ts`,
		);

		expect(script).toContain("class BunBundler");
	});

	// Bun's own failure is an AggregateError saying only "Bundle failed", which
	// leaves whoever ran the build nothing to act on.
	it("throws saying what it could not build", async () => {
		const missing = `${import.meta.dirname}/missing.ts`;

		await expect(new BunBundler().bundle(missing)).rejects.toThrow(missing);
	});
});
