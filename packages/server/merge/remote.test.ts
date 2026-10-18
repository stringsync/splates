import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	setDefaultTimeout,
} from "bun:test";
import { join } from "node:path";
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

		await merge(deps, tree);

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

	it("refuses a trunk moved on the remote after the rebase, spending an attempt", async () => {
		// The gate runs between the rebase and the landing.
		deps.config.preMerge = [
			`git -C ${other} pull --quiet --ff-only`,
			`git -C ${other} commit --quiet --allow-empty -m sneaked`,
			`git -C ${other} push --quiet origin main`,
		].join(" && ");

		await expect(merge(deps, tree)).toBail("merge_failed", {
			message: "moved from",
		});

		expect(await deps.gitCli(remote, "log", "-1", "--format=%s", "main")).toBe(
			"sneaked",
		);
		expect((await deps.service.find("alpha")).mergeAttempts).toBe(1);
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

	it("refuses a worker's merge with no remote to land through", async () => {
		deps.config.remote = null;

		await expect(merge({ ...deps, relayed: true }, tree)).toBail("blocked", {
			message: "set `remote`",
		});
		expect((await deps.service.find("alpha")).mergeAttempts).toBe(0);
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
});
