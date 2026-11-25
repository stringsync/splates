import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, readdir, realpath } from "node:fs/promises";
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

	it("names a listed spec's file from the project's root, absolute or relative, with its absolute path to open", async () => {
		const at = join(await realpath(commands.root), "evals", "refunds.ts");
		const listed = await launches.scenarios({
			...commands,
			list: `printf '%s\\n' '{"case":"a","file":"${at}"}' '{"case":"b","file":"evals/refunds.ts"}'`,
		});
		expect(listed.map(({ file, fileAt }) => ({ file, fileAt }))).toEqual([
			{ file: "evals/refunds.ts", fileAt: at },
			{ file: "evals/refunds.ts", fileAt: at },
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

	it("gives each of two runs going at once the batch that ran its own cases", async () => {
		// The first card's runner is slower, so the second's batch lands first.
		const both = {
			...commands,
			run: `case "$SPLATES_EVALS_CASES" in a) sleep 0.3;; esac; mkdir -p "$SPLATES_EVALS_RESULTS/batch-$SPLATES_EVALS_CASES" && printf '{"cells":[{"case":"%s"}]}' "$SPLATES_EVALS_CASES" > "$SPLATES_EVALS_RESULTS/batch-$SPLATES_EVALS_CASES/batch.json"`,
		};
		await launches.start(both, { ...spec, key: "card-a", scenarios: ["a"] });
		await launches.start(both, { ...spec, key: "card-b", scenarios: ["b"] });
		await eventually(
			async () =>
				(await launches.get(both, "card-a"))?.status === "done" &&
				(await launches.get(both, "card-b"))?.status === "done",
			5_000,
		);

		expect((await launches.get(both, "card-a"))?.batch).toBe("batch-a");
		expect((await launches.get(both, "card-b"))?.batch).toBe("batch-b");
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

	it("sums what each conversation's rounds cost from their batches", async () => {
		const fixture = join(deps.root, "fixture");
		await Bun.write(
			join(fixture, "batch.json"),
			JSON.stringify({
				format: "splates-evals/1",
				startedAt: "2026-11-24T00:00:00.000Z",
				cells: [{ id: "c1", case: "refunds/partial", target: { model: "m" } }],
			}),
		);
		await Bun.write(
			join(fixture, "results.jsonl"),
			`${JSON.stringify({ cell: "c1", status: "pass", costUsd: 1.25 })}\n`,
		);
		const costly = {
			...commands,
			run: `mkdir -p "$SPLATES_EVALS_RESULTS/round-$$" && cp ${fixture}/* "$SPLATES_EVALS_RESULTS/round-$$/"`,
		};
		await launches.start(costly, { ...spec, conversation: "c-1" });
		await done(launches, costly);
		await launches.start(costly, {
			...spec,
			key: "card-2",
			conversation: "c-1",
		});
		expect(
			await eventually(
				async () => (await launches.get(costly, "card-2"))?.status === "done",
				2_000,
			),
		).toBe(true);

		expect((await launches.costs()).get("c-1")).toEqual({
			usd: 2.5,
			last: "2026-11-24T00:00:00.000Z",
		});
		expect((await launches.costs("c-2")).get("c-2")).toBeUndefined();
		// Rounds before the first approval never count against the budget.
		await launches.rounds.answer("c-1", "b-1", 10, "2026-11-24T00:00:00.000Z");
		await launches.rounds.answer(
			"c-1",
			"b-2",
			null,
			"2026-11-25T00:00:00.000Z",
		);
		expect(await launches.budget("c-1")).toEqual({
			usd: 10,
			spent: 2.5,
			answers: { "b-1": 10, "b-2": null },
		});
		await launches.rounds.answer("c-2", "b-3", 5, "2026-11-25T00:00:00.000Z");
		expect(await launches.budget("c-2")).toEqual({
			usd: 5,
			spent: 0,
			answers: { "b-3": 5 },
		});
	});

	it("refuses a second answer to a budget card, or an amount that is no budget", async () => {
		await launches.rounds.answer("c-9", "b-1", 5, "2026-11-24T00:00:00.000Z");

		expect(
			launches.rounds.answer("c-9", "b-1", 5, "2026-11-24T00:00:00.000Z"),
		).rejects.toThrow("already answered");
		expect(
			launches.rounds.answer("c-9", "b-2", -1, "2026-11-24T00:00:00.000Z"),
		).rejects.toThrow("dollar amount");
		expect((await launches.budget("c-9")).usd).toBe(5);
	});

	it("seeds an automation eval budget onto one conversation, combining with hand top-ups", async () => {
		await launches.rounds.seed("c-auto", 2, "2026-11-24T00:00:00.000Z", {
			id: "7",
			name: "Spend unused quota",
		});
		// Idempotent for the same automation on the same conversation.
		await launches.rounds.seed("c-auto", 2, "2026-11-24T00:00:01.000Z", {
			id: "7",
			name: "Spend unused quota",
		});
		expect(await launches.budget("c-auto")).toEqual({
			usd: 2,
			spent: 0,
			answers: {},
			seeded: { usd: 2, automation: "7", name: "Spend unused quota" },
		});
		await launches.rounds.answer(
			"c-auto",
			"b-topup",
			5,
			"2026-11-24T01:00:00.000Z",
		);
		expect(await launches.budget("c-auto")).toEqual({
			usd: 7,
			spent: 0,
			answers: { "b-topup": 5 },
			seeded: { usd: 2, automation: "7", name: "Spend unused quota" },
		});
		// Nothing carries over to another conversation.
		expect(await launches.budget("c-other")).toEqual({
			usd: 0,
			spent: 0,
			answers: {},
		});
	});

	it("marks a round the server started within the conversation's budget as auto", async () => {
		const launch = await launches.start(commands, { ...spec, auto: true });

		expect(launch.auto).toBe(true);
		expect((await launches.get(commands, "card-1"))?.auto).toBe(true);
	});

	it("tells the conversation a run it stopped ended, so its agent is not left waiting", async () => {
		const slow = {
			...commands,
			run: `mkdir -p "$SPLATES_EVALS_RESULTS/nightly" && sleep 30`,
		};
		await launches.start(slow, { ...spec, conversation: "c-1" });
		await eventually(
			async () => (await launches.get(slow, "card-1"))?.batch === "nightly",
			2_000,
		);
		await launches.stop(slow, "card-1");
		await done(launches, slow);

		expect((await launches.get(slow, "card-1"))?.status).toBe("stopped");
		expect(await eventually(async () => finished.length === 1, 2_000)).toBe(
			true,
		);
		expect(finished[0]?.conversation).toBe("c-1");
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
		expect(await launches.ofBatch(commands, "second")).toMatchObject({
			key: "card-1",
			status: "done",
		});
		expect(await launches.ofBatch(commands, "none")).toBeNull();
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
