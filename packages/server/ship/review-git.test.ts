import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Testing } from "../testing";

describe("Git release review", () => {
	let env: Testing;
	beforeEach(async () => {
		env = await Testing.open();
	});
	afterEach(() => env.disposeAsync());

	it("includes commit history, API and changelog changes since the pinned release", async () => {
		await env.gitCli(env.root, "tag", "v1.0.0");
		const from = await env.git.head(env.root);
		await env.fs.write(`${env.root}/api.ts`, "export const adapter = 1;\n");
		await env.fs.write(`${env.root}/CHANGELOG.md`, "Added an adapter.\n");
		await env.git.commitAll(env.root, "Add adapter");
		const review = await env.git.releaseReview("1.0.0");
		expect(review.range).toBe(`${from}..${await env.git.head(env.root)}`);
		expect(review.commits).toContain("Add adapter");
		expect(review.diff).toContain("+export const adapter = 1;");
		expect(review.diff).toContain("+Added an adapter.");
	});

	it("refuses unavailable pinned releases instead of silently omitting evidence", async () => {
		await expect(env.git.releaseReview("9.0.0")).rejects.toThrow();
		await expect(env.git.releaseReview("^1.0.0")).rejects.toThrow(
			"exact pinned version",
		);
	});
});
