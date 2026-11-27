import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	setDefaultTimeout,
} from "bun:test";
import { join } from "node:path";
import type { Facts } from "../records";
import { add } from "../tasks";
import { Testing } from "../testing";
import { merge } from "./merge";

// Real git in a repo, a bare remote and a second clone each.
setDefaultTimeout(30_000);

describe("merge with a central remote", () => {
	let deps: Testing;
	let remote: string;
	/** Someone else's clone, which moves the remote's trunk behind the task's back. */
	let other: string;
	let tree: string;

	beforeEach(async () => {
		deps = await Testing.open();
		const base = join(deps.config.worktreeRoot, "..");
		remote = join(base, "remote.git");
		other = join(base, "other");
		await deps.gitCli(
			deps.root,
			"init",
			"--quiet",
			"--bare",
			"-b",
			"main",
			remote,
		);
		await deps.gitCli(deps.root, "remote", "add", "origin", remote);
		await deps.gitCli(deps.root, "push", "--quiet", "origin", "main");
		await deps.gitCli(base, "clone", "--quiet", remote, other);
		await deps.gitCli(other, "config", "user.email", "other@example.com");
		await deps.gitCli(other, "config", "user.name", "other");
		await deps.gitCli(other, "config", "commit.gpgsign", "false");
		deps.config.remote = "origin";
		deps.config.postRewrite = null;
		deps.config.preMerge = null;
		await add(deps, "alpha");
		tree = (await deps.service.find("alpha")).path;
		await deps.commit(tree, "alpha.txt", "alpha\n", "add alpha");
		await deps.finish(tree);
	});

	afterEach(() => deps.disposeAsync());

	/** The commit `ref` is at on the remote, or null when it has none. */
	const onRemote = async (ref: string): Promise<string | null> => {
		const { exitCode, stdout } = await deps.ps.spawnCapture([
			"git",
			"-C",
			remote,
			"rev-parse",
			"--verify",
			"--quiet",
			ref,
		]);
		return exitCode === 0 ? stdout.trim() : null;
	};

	/** A commit pushed to the remote's trunk from the other clone. */
	const pushElsewhere = async (file: string): Promise<void> => {
		await deps.gitCli(other, "pull", "--quiet", "--ff-only");
		await deps.commit(other, file, "theirs\n", `add ${file}`);
		await deps.gitCli(other, "push", "--quiet", "origin", "main");
	};

	it("rebases onto the remote's trunk, lands there, and brings this trunk along", async () => {
		await pushElsewhere("theirs.txt");

		const facts: Partial<Facts["merge"]> = {};
		await merge(deps, tree, facts);

		expect(facts.files).toEqual(["alpha.txt"]);
		expect(await deps.outcomes.list()).toEqual([
			expect.objectContaining({
				task: "alpha",
				size: { files: 1, added: 1, removed: 0 },
			}),
		]);
		const landed = await onRemote("refs/heads/main");
		expect(await deps.gitCli(remote, "log", "--format=%s", "main")).toBe(
			["add alpha", "add theirs.txt", "seed"].join("\n"),
		);
		expect(await deps.gitCli(deps.root, "rev-parse", "main")).toBe(
			landed ?? "",
		);
		expect(await deps.fs.exists(join(deps.root, "theirs.txt"))).toBe(true);
		expect(await onRemote("refs/heads/splates/alpha")).toBe(null);
		expect(await deps.fs.exists(deps.lockPath)).toBe(false);
	});

	it("rebases and retests a moved remote trunk without spending an attempt", async () => {
		const marker = join(other, "moved-once");
		deps.config.preMerge = [
			`if ! test -f ${marker}; then`,
			`git -C ${other} pull --quiet --ff-only &&`,
			`git -C ${other} commit --quiet --allow-empty -m sneaked &&`,
			`git -C ${other} push --quiet origin main && touch ${marker}; fi`,
		].join(" ");
		const facts: Partial<Facts["merge"]> = {};
		await merge(deps, tree, facts);
		expect(facts.attemptsLeft).toBe(deps.config.mergeRetryCount);
		expect(facts.retests).toBe(1);
		expect(await deps.gitCli(remote, "log", "--format=%s", "main")).toContain(
			"sneaked",
		);
		expect((await deps.service.find("alpha")).status).toBe("removed");
		expect(await deps.fs.exists(deps.lockPath)).toBe(false);
	});

	it("refuses, spending nothing, while this trunk holds commits the remote lacks", async () => {
		await deps.commit(deps.root, "local.txt", "local\n", "unpushed");
		const before = await onRemote("refs/heads/main");

		await expect(merge(deps, tree)).toBail("blocked", {
			message: "git push origin main",
		});

		expect(await onRemote("refs/heads/main")).toBe(before);
		expect((await deps.service.find("alpha")).mergeAttempts).toBe(0);
		expect((await deps.service.find("alpha")).status).toBe("working");
	});

	it("lands only for the holder of the merge lease", async () => {
		await deps.branches.push("alpha", "task/alpha");
		const head = await deps.gitCli(tree, "rev-parse", "HEAD");
		const onto = (await onRemote("refs/heads/main")) ?? "";

		expect(
			await deps.trunk.land({
				task: "alpha",
				onto,
				head,
				holder: { pid: 1, hostname: "elsewhere" },
			}),
		).toMatchObject({
			status: "refused",
			why: expect.stringContaining("no longer held"),
		});
		expect(await onRemote("refs/heads/main")).toBe(onto);
	});

	it("squashes onto the rebased remote trunk so a held merge rebases cleanly next time", async () => {
		// Remote trunk moves ahead while local main stays behind.
		await pushElsewhere("shared.txt");
		const firstRemote = (await onRemote("refs/heads/main")) ?? "";

		// Hold the first merge on an environment failure (no test files named).
		const ready = join(other, "gate-ready");
		deps.config.preMerge = `test -f ${ready}`;
		const facts: Partial<Facts["merge"]> = {};
		await expect(merge(deps, tree, facts, { message: "Add alpha" })).toBail(
			"tests_failed",
		);
		expect((await deps.service.find("alpha")).mergeAttempts).toBe(0);

		// The squashed commit's parent is the remote trunk it was rebased onto,
		// not the stale local main, so it only touches the task's own file.
		expect(await deps.gitCli(tree, "rev-parse", "HEAD^")).toBe(firstRemote);
		expect(
			await deps.gitCli(tree, "show", "--name-only", "--format=", "HEAD"),
		).toBe("alpha.txt");

		// Remote trunk modifies shared.txt again; a squash parented on the old
		// local main would conflict here on the next rebase.
		await deps.gitCli(other, "pull", "--quiet", "--ff-only");
		await deps.commit(other, "shared.txt", "theirs v2\n", "update shared.txt");
		await deps.gitCli(other, "push", "--quiet", "origin", "main");

		await deps.fs.write(ready, "ok\n");
		await merge(deps, tree, {}, { message: "Add alpha" });

		expect(await deps.gitCli(remote, "log", "--format=%s", "main")).toBe(
			["Add alpha", "update shared.txt", "add shared.txt", "seed"].join("\n"),
		);
		expect(
			await deps.gitCli(remote, "show", "--name-only", "--format=", "main"),
		).toBe("alpha.txt");
	});
});
