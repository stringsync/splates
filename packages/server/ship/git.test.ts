import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync } from "node:fs";
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

	/** A process runner where another commit lands on trunk as `git ls-remote` ends. */
	function landingDuringLsRemote(): Testing["ps"] {
		const ps = Object.create(env.ps);
		ps.spawnCapture = async (cmd: string[], opts: unknown) => {
			const result = await env.ps.spawnCapture(cmd, opts as never);
			if (cmd[1] === "ls-remote") {
				await commitEmpty("landed");
			}
			return result;
		};
		return ps;
	}

	/** Commits an empty change on trunk and returns the new HEAD. */
	async function commitEmpty(message: string): Promise<string> {
		await env.gitCli(env.root, "commit", "--allow-empty", "-m", message);
		return env.gitCli(env.root, "rev-parse", "HEAD");
	}

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

	it("counts a deploy's commits since the deployed one, under its paths only", async () => {
		const deployed = await env.gitCli(env.root, "rev-parse", "HEAD");
		mkdirSync(`${env.root}/web`);
		await Bun.write(`${env.root}/web/a.txt`, "a");
		await env.gitCli(env.root, "add", ".");
		await env.gitCli(env.root, "commit", "-m", "web");
		await env.gitCli(env.root, "commit", "--allow-empty", "-m", "elsewhere");
		expect(await git.since(deployed.trim(), ["web/**"])).toMatchObject({
			commits: 1,
			error: null,
		});
		expect(await git.since("nope", ["web/**"])).toMatchObject({
			commits: null,
		});
	});

	it("tells a release whose tag never reached the remote from one that did", async () => {
		// A remote with no release tags at all is a project that does not tag.
		expect(await git.tagged("1.0.1")).toBe(true);
		await env.gitCli(env.root, "push", "origin", "v1.0.0");
		expect(await git.tagged("1.0.0")).toBe(true);
		expect(await git.tagged("1.0.1")).toBe(false);
	});

	it("reports unknown for a missing tag or a tag outside trunk history", async () => {
		expect(await git.changes("2.0.0")).toMatchObject({ commits: null });
		await env.gitCli(env.root, "checkout", "-b", "task/demo");
		await env.gitCli(env.root, "commit", "--allow-empty", "-m", "task only");
		await env.gitCli(env.root, "tag", "v2.0.0");
		expect(await git.changes("2.0.0")).toMatchObject({ commits: null });
	});

	it("counts a project's commits since the one that stamped its version, under its own paths", async () => {
		mkdirSync(`${env.root}/a`);
		mkdirSync(`${env.root}/b`);
		await env.commit(
			env.root,
			"a/package.json",
			'{"version": "3.0.0"}',
			"Release 3.0.0",
		);
		await env.commit(env.root, "b/file.txt", "other", "another project's work");
		expect(await git.changes("3.0.0", ["a/**"])).toMatchObject({
			commits: 0,
			tag: "v3.0.0",
		});
		await env.commit(env.root, "a/file.txt", "mine", "unreleased work");
		expect(await git.changes("3.0.0", ["a/**"])).toMatchObject({ commits: 1 });
		expect(await git.changes("9.9.9", ["a/**"])).toMatchObject({
			commits: null,
		});
	});

	it("pushes unpushed commits and verifies the remote ref", async () => {
		const head = await commitEmpty("unpushed");
		expect(await git.sync()).toBe(`origin/main verified at ${head}`);
		expect(await env.gitCli(remote, "rev-parse", "refs/heads/main")).toBe(head);
	});

	it("accepts trunk gaining commits while the push is verified", async () => {
		const head = await commitEmpty("release");
		const ps = landingDuringLsRemote();
		expect(await new ReleaseGit(ps, env.root).sync()).toBe(
			`origin/main verified at ${head}`,
		);
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
		expect(git.sync()).rejects.toThrow("clean tree");
		await env.fs.rm(`${env.root}/untracked`);
		await env.gitCli(env.root, "checkout", "-b", "task/demo");
		expect(git.sync()).rejects.toThrow("Shipping requires main");
	});

	it("refuses when remote is ahead or diverged, leaving it untouched", async () => {
		const before = await env.gitCli(env.root, "rev-parse", "HEAD");
		await env.gitCli(env.root, "commit", "--allow-empty", "-m", "remote work");
		await env.gitCli(env.root, "push", "origin", "main");
		const ahead = await env.gitCli(env.root, "rev-parse", "HEAD");
		await env.gitCli(env.root, "reset", "--hard", before);
		expect(git.sync()).rejects.toThrow("merge-base");
		await env.gitCli(env.root, "commit", "--allow-empty", "-m", "local work");
		expect(git.sync()).rejects.toThrow("merge-base");
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
		expect(git.sync()).rejects.toThrow("git fetch");
	});
});
