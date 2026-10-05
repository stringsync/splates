import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { dirname, join } from "node:path";
import { Testing } from "./testing";

describe("Git", () => {
	let env: Testing;

	beforeEach(async () => {
		env = await Testing.open();
	});

	afterEach(() => env.disposeAsync());

	it("names the branch checked out", async () => {
		expect(await env.git.currentBranch(env.root)).toBe("main");
	});

	it("names no branch on a detached HEAD", async () => {
		await env.gitCli(env.root, "checkout", "--detach");

		expect(await env.git.currentBranch(env.root)).toBeNull();
	});

	it("names no branch outside any repository", async () => {
		expect(await env.git.currentBranch(dirname(env.root))).toBeNull();
	});

	it("throws when git fails for another reason, rather than naming no branch", async () => {
		await expect(env.git.currentBranch(join(env.root, "gone"))).rejects.toThrow(
			"git symbolic-ref HEAD",
		);
	});
});
