import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Testing } from "../testing";
import { ReleaseGit } from "./git";

describe("ReleaseGit", () => {
	let env: Testing;
	let git: ReleaseGit;
	let remote: string;
	beforeEach(async () => {
		env = await Testing.open();
		remote = `${env.root}/../remote.git`;
		await env.gitCli(env.root, "init", "--bare", remote);
		await env.gitCli(env.root, "remote", "add", "origin", remote);
		await env.gitCli(env.root, "push", "origin", "main");
		await env.gitCli(env.root, "tag", "v1.0.0");
		git = new ReleaseGit(env.ps, env.root);
	});
	afterEach(() => env.disposeAsync());

	it("counts commits after the release tag on trunk, ignoring a checked out task", async () => {
		expect(await git.changes("1.0.0")).toMatchObject({
			commits: 0,
			branch: "main",
		});
		await env.gitCli(env.root, "commit", "--allow-empty", "-m", "unreleased");
		await env.gitCli(env.root, "checkout", "-b", "task/demo");
		await env.gitCli(env.root, "commit", "--allow-empty", "-m", "task only");
		expect(await git.changes("1.0.0")).toMatchObject({
			commits: 1,
			tag: "v1.0.0",
		});
	});

	it("reports unknown for a missing tag or a tag outside trunk history", async () => {
		expect(await git.changes("2.0.0")).toMatchObject({ commits: null });
		await env.gitCli(env.root, "checkout", "-b", "task/demo");
		await env.gitCli(env.root, "commit", "--allow-empty", "-m", "task only");
		await env.gitCli(env.root, "tag", "v2.0.0");
		expect(await git.changes("2.0.0")).toMatchObject({ commits: null });
	});

	it("pushes unpushed commits and verifies the remote ref", async () => {
		await env.gitCli(env.root, "commit", "--allow-empty", "-m", "unpushed");
		const head = await env.gitCli(env.root, "rev-parse", "HEAD");
		expect(await git.sync()).toBe(`origin/main verified at ${head}`);
		expect(await env.gitCli(remote, "rev-parse", "refs/heads/main")).toBe(head);
	});

	it("supports master as the remote default branch", async () => {
		await env.gitCli(env.root, "branch", "-m", "master");
		await env.gitCli(env.root, "push", "origin", "master");
		await env.gitCli(
			env.root,
			"symbolic-ref",
			"refs/remotes/origin/HEAD",
			"refs/remotes/origin/master",
		);
		expect(await git.changes("1.0.0")).toMatchObject({
			branch: "master",
			commits: 0,
		});
		expect(await git.sync()).toContain("origin/master verified");
	});

	it("refuses a dirty tree and a task branch before pushing", async () => {
		await env.fs.write(`${env.root}/untracked`, "work");
		await expect(git.sync()).rejects.toThrow("clean tree");
		await env.fs.rm(`${env.root}/untracked`);
		await env.gitCli(env.root, "checkout", "-b", "task/demo");
		await expect(git.sync()).rejects.toThrow("Shipping requires main");
	});

	it("refuses when remote is ahead or diverged, leaving it untouched", async () => {
		const before = await env.gitCli(env.root, "rev-parse", "HEAD");
		await env.gitCli(env.root, "commit", "--allow-empty", "-m", "remote work");
		await env.gitCli(env.root, "push", "origin", "main");
		const ahead = await env.gitCli(env.root, "rev-parse", "HEAD");
		await env.gitCli(env.root, "reset", "--hard", before);
		await expect(git.sync()).rejects.toThrow("merge-base");
		await env.gitCli(env.root, "commit", "--allow-empty", "-m", "local work");
		await expect(git.sync()).rejects.toThrow("merge-base");
		expect(await env.gitCli(remote, "rev-parse", "refs/heads/main")).toBe(
			ahead,
		);
	});

	it("fails on an unreachable remote", async () => {
		await env.gitCli(
			env.root,
			"remote",
			"set-url",
			"origin",
			`${env.root}/missing.git`,
		);
		await expect(git.sync()).rejects.toThrow("git fetch");
	});
});
