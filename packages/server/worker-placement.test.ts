import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join, resolve } from "node:path";
import { add } from "./add";
import { claim } from "./claim";
import { CloneCheckouts } from "./clone-checkouts";
import { Git } from "./git";
import { TaskBranches } from "./task-branches";
import { Testing } from "./testing";
import { LocalWorkerMachine } from "./worker-machine";
import { WorkerPlacement } from "./worker-placement";
import { WorktreeService } from "./worktree-service";

describe("WorkerPlacement", () => {
	let deps: Testing;
	/** The worker `w1`, which this test's machine stands in for. */
	let machine: LocalWorkerMachine;
	let placement: WorkerPlacement;
	/** The project's clone on `w1`, readied for an agent of no task. */
	let clone: string;
	/** What `w1` opens in `clone`, its records reached through the relay. */
	let worker: {
		service: WorktreeService;
		config: typeof deps.config;
		branches: TaskBranches;
	};

	beforeEach(async () => {
		deps = await Testing.open();
		const remote = join(deps.config.worktreeRoot, "..", "remote.git");
		await deps.gitCli(deps.root, "init", "--bare", remote);
		await deps.gitCli(deps.root, "remote", "add", "origin", remote);
		await deps.gitCli(deps.root, "push", "--quiet", "origin", "main");
		deps.config.remote = "origin";
		machine = new LocalWorkerMachine(deps.ps, deps.fs);
		placement = new WorkerPlacement({
			service: deps.service,
			branches: new TaskBranches(deps.git, deps.config, {
				app: async () => null,
			}),
			config: deps.config,
			slug: async () => "repo",
		});
		clone = await placement.where("w1", machine, null);
		worker = onWorker(clone);
	});

	afterEach(() => deps.disposeAsync());

	/** What a worker opens in its project clone at `clone`. */
	const onWorker = (clone: string) => {
		const git = new Git(clone, { ps: deps.ps, fs: deps.fs });
		const config = {
			...deps.config,
			worktreeRoot: resolve(clone, "..", "repo-splates.noindex"),
		};
		const branches = new TaskBranches(git, config, { app: async () => null });
		const service = new WorktreeService(git, config, deps.splatesDir, {
			fs: deps.fs,
			ps: deps.ps,
			clones: {
				checkouts: new CloneCheckouts(git, config, branches, deps.fs),
				machine: "w1",
			},
		});
		return { service, config, branches };
	};

	it("readies the project's clone for an agent of no task", async () => {
		expect(await deps.gitCli(clone, "rev-parse", "HEAD")).toBe(
			await deps.gitCli(deps.root, "rev-parse", "HEAD"),
		);
	});

	it("pushes a task checked out here, so the agent's claim on the worker clones it", async () => {
		await add(deps, "alpha");
		const here = await deps.service.find("alpha");
		await deps.commit(here.path, "a.txt", "one\n", "a");
		const tip = await deps.gitCli(here.path, "rev-parse", "HEAD");

		expect(await placement.where("w1", machine, "alpha")).toBe(clone);
		expect(await placement.elsewhere("alpha")).toBe(false);

		await claim(
			{
				service: worker.service,
				log: deps.log,
				fs: deps.fs,
				branches: worker.branches,
			},
			"alpha",
		);
		const there = await worker.service.find("alpha");
		expect(there.machine).toBe("w1");
		expect(there.path).not.toBe(here.path);
		expect(await deps.gitCli(there.path, "rev-parse", "HEAD")).toBe(tip);
		expect(await placement.elsewhere("alpha")).toBe(true);
	});

	it("starts in the task's clone on the worker that holds it, and readies the project again once it is gone", async () => {
		await add(
			{ ...deps, service: worker.service, config: worker.config },
			"alpha",
		);
		const alpha = await worker.service.find("alpha");

		expect(await placement.where("w1", machine, "alpha")).toBe(alpha.path);
		// Another worker clones it again from the project's clone there.
		expect(await placement.where("w2", machine, "alpha")).toBe(clone);

		await deps.fs.rm(alpha.path, { recursive: true, force: true });
		expect(await placement.where("w1", machine, "alpha")).toBe(clone);
	});

	it("refuses a project with no central remote", async () => {
		deps.config.remote = null;

		expect(placement.where("w2", machine, null)).rejects.toThrow(
			"no central remote",
		);
	});
});
