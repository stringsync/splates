import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Config } from "../config";
import { Git } from "../git";
import { PLAN_FILE, PlanStore } from "../plans";
import { add, claim, rescueStranded, WorktreeService } from "../tasks";
import { Testing } from "../testing";
import { LocalWorkerMachine } from "../workers";
import { TaskBranches } from "./branches";
import { CloneCheckouts } from "./clone-checkouts";

describe("CloneCheckouts", () => {
	let deps: Testing;
	let remote: string;
	/** What a remote worker, `w1`, opens its project clone with. */
	let worker: {
		machine: LocalWorkerMachine;
		clone: string;
		git: Git;
		config: Config;
		branches: TaskBranches;
		service: WorktreeService;
	};

	beforeEach(async () => {
		deps = await Testing.open();
		remote = join(deps.config.worktreeRoot, "..", "remote.git");
		await deps.gitCli(deps.root, "init", "--bare", "-b", "main", remote);
		await deps.gitCli(deps.root, "remote", "add", "origin", remote);
		await deps.gitCli(deps.root, "push", "--quiet", "origin", "main");
		deps.config.remote = "origin";
		const machine = new LocalWorkerMachine(deps.ps, deps.fs);
		const clone = await machine.checkout({
			project: "repo",
			url: remote,
			remote: "origin",
			trunk: "main",
			env: {},
		});
		const git = new Git(clone, { ps: deps.ps, fs: deps.fs });
		const config = {
			...deps.config,
			worktreeRoot: resolve(clone, "..", "repo-splates.noindex"),
		};
		const branches = new TaskBranches(
			git,
			config,
			{ app: async () => null },
			new PlanStore(deps.fs, deps.storage),
		);
		// Its records are the coordinator's, as the relay reaches them.
		const service = new WorktreeService(git, config, deps.splatesDir, {
			fs: deps.fs,
			ps: deps.ps,
			clones: {
				checkouts: new CloneCheckouts(git, config, branches, deps.fs),
				machine: "w1",
			},
		});
		worker = { machine, clone, git, config, branches, service };
		// Added as an agent on the worker adds it.
		await add({ ...deps, service, config }, "alpha");
		await deps.commit(
			(await service.find("alpha")).path,
			"a.txt",
			"one\n",
			"a",
		);
	});

	afterEach(() => deps.disposeAsync());

	/** The coordinator's view, holding the workers in `machines`. */
	const coordinator = (machines: Map<string, LocalWorkerMachine>) =>
		new WorktreeService(deps.git, deps.config, deps.splatesDir, {
			fs: deps.fs,
			ps: deps.ps,
			machines: {
				machine: (id) => machines.get(id) ?? null,
				joined: () => () => {},
			},
		});

	/** The commit the remote has as `ref`, or null when it has none. */
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

	it("keeps a mirror and a clone of trunk, at a canonical path", async () => {
		expect(worker.clone).toBe(await realpath(worker.clone));
		const mirror = await deps.gitCli(worker.clone, "config", "splates.mirror");
		expect(await deps.gitCli(mirror, "rev-parse", "--is-bare-repository")).toBe(
			"true",
		);

		await deps.commit(deps.root, "b.txt", "two\n", "b");
		await deps.gitCli(deps.root, "push", "--quiet", "origin", "main");
		await worker.machine.checkout({
			project: "repo",
			url: remote,
			remote: "origin",
			trunk: "main",
			env: {},
		});
		expect(await deps.gitCli(worker.clone, "rev-parse", "HEAD")).toBe(
			await deps.gitCli(deps.root, "rev-parse", "HEAD"),
		);
	});

	it("adds a task as a clone that borrows the mirror's objects", async () => {
		const alpha = await worker.service.find("alpha");
		expect(alpha.status).toBe("working");
		expect(alpha.machine).toBe("w1");
		expect(alpha.state?.machine).toBe("w1");
		expect(await deps.gitCli(alpha.path, "branch", "--show-current")).toBe(
			"task/alpha",
		);
		expect(
			await deps.fs.read(join(alpha.path, ".git/objects/info/alternates")),
		).toContain("mirrors/repo.git");
		expect(await deps.gitCli(alpha.path, "config", "splates.home")).toBe(
			worker.clone,
		);
		// The plan stays out of git in the clone, as in a worktree.
		expect(
			await deps.gitCli(alpha.path, "status", "--porcelain"),
		).not.toContain(PLAN_FILE);

		expect(await alpha.commitsAhead()).toBe(1);
		expect(await alpha.changedFiles()).toEqual(["a.txt"]);
	});

	it("pushes from the clone, and clones the task again from what it pushed", async () => {
		let alpha = await worker.service.find("alpha");
		const tip = await deps.gitCli(alpha.path, "rev-parse", "HEAD");

		expect(
			await worker.branches.push("alpha", alpha.branch, { at: alpha.git }),
		).toEqual({ status: "pushed", branch: "splates/alpha" });
		expect(await onRemote("refs/heads/splates/alpha")).toBe(tip);

		await deps.fs.write(join(alpha.path, PLAN_FILE), "# alpha\n");
		await worker.branches.pushTree(alpha);
		expect(await deps.fs.read(`${deps.splatesDir}/plans/alpha.md`)).toBe(
			"# alpha\n",
		);

		// The worker's disk is a cache: its clone goes, and the task with it.
		await deps.fs.rm(alpha.path, { recursive: true, force: true });
		alpha = await worker.service.find("alpha");
		expect(worker.service.elsewhere(alpha)).toBe(true);

		await claim(
			{
				service: worker.service,
				log: deps.log,
				fs: deps.fs,
				branches: worker.branches,
			},
			"alpha",
		);
		alpha = await worker.service.find("alpha");
		expect(alpha.status).toBe("working");
		// The plan comes back with the clone.
		expect(await deps.fs.read(join(alpha.path, PLAN_FILE))).toBe("# alpha\n");
		expect(await deps.gitCli(alpha.path, "rev-parse", "HEAD")).toBe(tip);
		expect(await deps.gitCli(alpha.path, "branch", "--show-current")).toBe(
			"task/alpha",
		);
		expect(await alpha.commitsAhead()).toBe(1);
	});

	it("reads a task cloned on a worker through that worker", async () => {
		const alpha = await coordinator(new Map([["w1", worker.machine]])).find(
			"alpha",
		);
		expect(alpha.status).toBe("working");
		expect(alpha.hasBranch).toBe(true);
		expect(await alpha.commitsAhead()).toBe(1);

		// A worker that has not joined is taken to hold it still.
		expect((await coordinator(new Map()).find("alpha")).status).toBe("working");
	});

	// scry-ignore simple-test-setup: w2 is this one test's alone; the others never reach a second worker
	it("pushes the commits a worker made while away once it rejoins, for the agent that carried on to hear of", async () => {
		const alpha = await worker.service.find("alpha");
		await worker.branches.push("alpha", alpha.branch, { at: alpha.git });
		// Made after the last push, on a worker then out of reach.
		await deps.commit(alpha.path, "late.txt", "late\n", "late");
		const late = await deps.gitCli(alpha.path, "rev-parse", "HEAD");
		// The task carries on from that push on w2, whose clones sit elsewhere.
		const config = {
			...worker.config,
			worktreeRoot: resolve(worker.clone, "..", "w2.noindex"),
		};
		const carried = new WorktreeService(worker.git, config, deps.splatesDir, {
			fs: deps.fs,
			ps: deps.ps,
			clones: {
				checkouts: new CloneCheckouts(
					worker.git,
					config,
					worker.branches,
					deps.fs,
				),
				machine: "w2",
			},
		});
		await carried.resume(await carried.find("alpha"));
		expect((await carried.find("alpha")).machine).toBe("w2");
		expect((await carried.states())[0]?.stranded).toHaveLength(1);

		await rescueStranded("w1", {
			service: coordinator(new Map([["w1", worker.machine]])),
			machines: {
				machine: (id) => (id === "w1" ? worker.machine : null),
				joined: () => () => {},
			},
			branches: worker.branches,
			log: deps.log,
		});

		expect(await onRemote("refs/heads/splates/alpha-w1")).toBe(late);
		const [state] = await carried.states();
		expect(state?.stranded).toBeUndefined();
		expect(state?.rescued).toEqual([
			{ machine: "w1", branch: "splates/alpha-w1", commits: 1 },
		]);
	});

	it("takes a clone away on removal, and refuses a path that is none", async () => {
		const alpha = await worker.service.find("alpha");

		await alpha.discard("removed");

		expect(await deps.fs.exists(alpha.path)).toBe(false);
		expect((await worker.service.find("alpha")).status).toBe("removed");
		expect(worker.machine.removeCheckout(deps.root)).rejects.toThrow(
			"no checkout of this worker's",
		);
	});
});
