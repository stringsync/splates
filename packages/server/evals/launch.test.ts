import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Testing } from "../testing";
import { type EvalFinished, EvalLaunches } from "./launch";

describe("EvalLaunches", () => {
	let deps: Testing;
	let launches: EvalLaunches;
	let finished: EvalFinished[];

	beforeEach(async () => {
		deps = await Testing.open();
		const checkout = join(deps.root, "checkout");
		const directory = join(deps.root, "evals");
		await mkdir(join(checkout, "bin"), { recursive: true });
		await mkdir(directory, { recursive: true });
		// Stands in for the runner: writes its batch where it is told, then exits.
		const runner = join(checkout, "bin/splates");
		await writeFile(
			runner,
			`#!/bin/sh\nmkdir -p "${directory}/batch-one"\necho done\n`,
		);
		await chmod(runner, 0o755);
		launches = new EvalLaunches({ ps: deps.ps, checkout, directory });
		finished = [];
		launches.events.on("finished", (each) => finished.push(each));
	});

	afterEach(async () => {
		launches.dispose();
		await deps.disposeAsync();
	});

	const spec = {
		key: "card-1",
		skill: "splates",
		scenarios: ["resources/install"],
		agents: [{ agent: "claude" }],
		baseline: null,
	};

	it("tells the conversation whose card started a run once it is done", async () => {
		await launches.start({ ...spec, conversation: "c-1" });
		await done(launches);

		expect(finished).toHaveLength(1);
		expect(finished[0]?.conversation).toBe("c-1");
		expect(finished[0]?.launch.batch).toBe("batch-one");
	});

	it("tells no one of a run started from no conversation", async () => {
		await launches.start(spec);
		await done(launches);

		expect(finished).toEqual([]);
	});

	it("runs the evals of the task worktree it is given, writing batches where the page reads", async () => {
		const worktree = await taskWorktree(deps.root);
		await launches.start({ ...spec, evalCheckout: worktree });
		await done(launches);

		const launch = await launches.get("card-1");
		expect(launch?.batch).toBe("batch-wt");
		expect(launch?.output).toContain("worktree");
	});
});

/** Waits for card-1's run to end. */
async function done(launches: EvalLaunches): Promise<void> {
	for (let tries = 0; tries < 200; tries++) {
		if ((await launches.get("card-1"))?.status !== "running") {
			return;
		}
		await Bun.sleep(10);
	}
	throw new Error("the run never ended");
}

/** A task worktree whose runner writes a batch and prints where it ran. */
async function taskWorktree(root: string): Promise<string> {
	const worktree = join(root, "task-worktree");
	await mkdir(join(worktree, "bin"), { recursive: true });
	const runner = join(worktree, "bin/splates");
	await writeFile(
		runner,
		`#!/bin/sh\nmkdir -p "${join(root, "evals")}/batch-wt"\npwd\n`,
	);
	await chmod(runner, 0o755);
	return worktree;
}
