import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { eventually } from "../server/testing";
import { Testing } from "../testing";
import {
	type EvalCommands,
	type EvalFinished,
	EvalLaunches,
	type EvalRunning,
} from "./launch";

describe("EvalLaunches", () => {
	let deps: Testing;
	let launches: EvalLaunches;
	let finished: EvalFinished[];
	let running: EvalRunning[];
	let commands: EvalCommands;

	beforeEach(async () => {
		deps = await Testing.open();
		const root = join(deps.root, "project");
		const results = join(deps.root, "evals");
		await mkdir(root, { recursive: true });
		await mkdir(results, { recursive: true });
		// Stands in for a framework: writes its batch where it is told, then exits.
		commands = {
			root,
			results,
			list: `printf '%s\\n' '{"case":"refunds/partial","group":"refunds","about":"Refunds part"}' 'not json' '{"case":"refunds/full"}'`,
			run: `mkdir -p "$SPLATES_EVALS_RESULTS/nightly" && printf '%s|%s|%s|%s\\n' "$SPLATES_EVALS_CASES" "$SPLATES_EVALS_TARGETS" "$SPLATES_EVALS_REPS" "$PWD"`,
			plan: null,
		};
		launches = new EvalLaunches(deps.ps, deps.machine);
		finished = [];
		launches.events.on("finished", (each) => finished.push(each));
		running = [];
		launches.events.on("running", (each) => running.push(each));
	});

	afterEach(async () => {
		await launches.disposeAsync();
		await deps.disposeAsync();
	});

	const spec = {
		key: "card-1",
		skill: "refunds",
		scenarios: ["refunds/partial"],
		agents: [{ agent: "claude" }],
		baseline: null,
	};

	it("lists the cases the project's list prints, skipping lines that are not one", async () => {
		expect(await launches.scenarios(commands)).toEqual([
			{ id: "refunds/partial", group: "refunds", about: "Refunds part" },
			{ id: "refunds/full", group: null, about: null },
		]);
	});

	it("tells the run its cases, targets and repetitions, and finds the batch it writes", async () => {
		await launches.start(commands, {
			...spec,
			scenarios: ["a", "b"],
			agents: [{ agent: "claude", model: "opus", effort: "high" }],
			reps: 2,
		});
		await done(launches, commands);

		const launch = await launches.get(commands, "card-1");
		expect(launch?.batch).toBe("nightly");
		expect(launch?.output).toContain(
			`a\nb|claude:opus@high|2|${commands.root}`,
		);
	});

	it("tells the conversation whose card started a run once it is done", async () => {
		await launches.start(commands, { ...spec, conversation: "c-1" });
		await done(launches, commands);

		expect(await eventually(async () => finished.length === 1, 2_000)).toBe(
			true,
		);
		expect(finished[0]?.conversation).toBe("c-1");
		expect(finished[0]?.results).toBe(commands.results);
		expect(finished[0]?.launch.batch).toBe("nightly");
	});

	it("tells no one of a run started from no conversation", async () => {
		await launches.start(commands, spec);
		await done(launches, commands);

		expect(finished).toEqual([]);
		expect(running).toEqual([]);
	});

	it("says a conversation's run is going, leaving its end to whoever tells it the run is done", async () => {
		await launches.start(commands, { ...spec, conversation: "c-1" });

		expect(running).toEqual([{ conversation: "c-1", running: true }]);
		await done(launches, commands);
		expect(await eventually(async () => finished.length === 1, 2_000)).toBe(
			true,
		);
		expect(running).toEqual([{ conversation: "c-1", running: true }]);
	});

	it("says a conversation's run has ended when it ends with no batch to report", async () => {
		await launches.start(
			{ ...commands, run: "echo no key >&2; exit 1" },
			{ ...spec, conversation: "c-1" },
		);
		await done(launches, commands);

		expect(await eventually(async () => running.length === 2, 2_000)).toBe(
			true,
		);
		expect(running[1]).toEqual({ conversation: "c-1", running: false });
	});

	it("runs in the task worktree it is given, writing batches where the page reads", async () => {
		const worktree = join(deps.root, "task-worktree");
		await mkdir(worktree, { recursive: true });

		await launches.start(commands, { ...spec, cwd: worktree });
		await done(launches, commands);

		const launch = await launches.get(commands, "card-1");
		expect(launch?.batch).toBe("nightly");
		expect(launch?.output).toContain(worktree);
	});

	it("calls a run that fails before writing a batch refused", async () => {
		await launches.start({ ...commands, run: "echo no key >&2; exit 1" }, spec);
		await done(launches, commands);

		const launch = await launches.get(commands, "card-1");
		expect(launch?.status).toBe("refused");
		expect(launch?.output).toBe("no key");
	});

	it("shows no ceiling for a project that prints no plan, and refuses nothing", async () => {
		expect(await launches.plan(commands, spec)).toEqual({
			cells: null,
			usd: null,
			refused: false,
			output: "",
		});
	});

	it("reads the ceiling off the project's plan, or its refusal", async () => {
		const planned = await launches.plan(
			{
				...commands,
				plan: `echo "planning $SPLATES_EVALS_CASES"; echo '{"cells": 3, "usd": 1.5}'`,
			},
			spec,
		);
		const refused = await launches.plan(
			{ ...commands, plan: "echo over budget; exit 2" },
			spec,
		);

		expect(planned).toMatchObject({ cells: 3, usd: 1.5, refused: false });
		expect(refused).toMatchObject({
			usd: null,
			refused: true,
			output: "over budget",
		});
	});

	it("resumes an in-progress run with its card and conversation through a restart", async () => {
		const run = `count=$(cat "$SPLATES_EVALS_RESULTS/attempt" 2>/dev/null || printf 0); count=$((count + 1)); printf %s "$count" > "$SPLATES_EVALS_RESULTS/attempt"; if [ "$count" -eq 1 ]; then mkdir -p "$SPLATES_EVALS_RESULTS/first"; sleep 30; else mkdir -p "$SPLATES_EVALS_RESULTS/second"; printf resumed; fi`;
		commands = { ...commands, run };
		await launches.start(commands, { ...spec, conversation: "c-1" });
		expect(
			await eventually(
				async () => (await readdir(commands.results)).includes("first"),
				2_000,
			),
		).toBe(true);
		await launches.disposeAsync();

		launches = new EvalLaunches(deps.ps, deps.machine);
		launches.events.on("finished", (each) => finished.push(each));
		expect(await launches.get(commands, "card-1")).toMatchObject({
			status: "running",
			batch: "first",
		});
		await launches.resume([commands]);
		await done(launches, commands);

		expect(await launches.get(commands, "card-1")).toMatchObject({
			status: "done",
			batch: "second",
			output: "resumed",
		});
		expect(await eventually(async () => finished.length === 1, 2_000)).toBe(
			true,
		);
		expect(finished[0]?.conversation).toBe("c-1");
	});
});

/** Waits for card-1's run to end. */
async function done(
	launches: EvalLaunches,
	commands: EvalCommands,
): Promise<void> {
	for (let tries = 0; tries < 200; tries++) {
		if ((await launches.get(commands, "card-1"))?.status !== "running") {
			return;
		}
		await Bun.sleep(10);
	}
	throw new Error("the run never ended");
}
