import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import lifecycle from "./lifecycle.probes";
import { assess, type Event, type Evidence, type Json } from "./probe";
import { cliAdapter } from "./probe-adapters";
import { loadModules } from "./probe-cli";
import { runProbes, validate } from "./runner";

let directory: string;
beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), "lifecycle-test-"));
});
afterEach(async () => {
	await rm(directory, { recursive: true, force: true });
});

it("validates and automatically discovers lifecycle without a shared registry edit", async () => {
	expect(() => validate(lifecycle.probes)).not.toThrow();
	expect((await loadModules([])).probes).toEqual(
		expect.arrayContaining(lifecycle.probes),
	);
});

// Synthetic traces test assertion behavior only, never real agent adherence.
it("requires successful add before investigation and preserves the read-scope gap", () => {
	const read = file("read", "value.txt");
	expect(result("start", [add(), read], startState).status).toBe("uncovered");
	expect(result("start", [read], startState).status).toBe("fail");
	expect(
		result("start", [{ ...add(), exitCode: 1 }, read], startState).status,
	).toBe("fail");
	expect(result("start", [read, add(), read], startState).status).toBe("fail");
	expect(
		result("start", [add(), read, file("write", "value.txt")], startState)
			.status,
	).toBe("fail");
	expect(result("start", [add(), read], startState, ["state"]).status).toBe(
		"uncovered",
	);
});

it("checks TASK claim before both plan and code reads, including failed forbidden adds", () => {
	const reads = [file("read", "ARBOR.md"), file("read", "value.txt")];
	const claim = command(["claim", "sample"]);
	const state = { "task/status": "working" };
	expect(result("claim", [claim, ...reads], state).status).toBe("pass");
	expect(result("claim", reads, state).status).toBe("fail");
	expect(result("claim", [...reads, claim], state).status).toBe("fail");
	expect(
		result("claim", [claim, ...reads, { ...add(), exitCode: 1 }], state).status,
	).toBe("fail");
	expect(
		result("claim", [{ ...claim, actor: "fixture" }, ...reads], state).status,
	).toBe("fail");
	expect(result("claim", [claim, ...reads], {}, ["events"]).status).toBe(
		"uncovered",
	);
});

it("requires planning and overlap inspection before editing, with plan-content gap", () => {
	const plan = file("write", "ARBOR.md");
	const inspect = command(["list", "--files"]);
	const edit = file("write", "value.txt");
	const state = { "main/value": "one\n" };
	expect(result("plan", [plan, inspect, edit], state).status).toBe("uncovered");
	expect(result("plan", [inspect, edit], state).status).toBe("fail");
	expect(result("plan", [edit, plan, inspect, edit], state).status).toBe(
		"fail",
	);
	expect(
		result("plan", [plan, inspect, edit, command(["merge"], 7)], state).status,
	).toBe("fail");
});

// scry-ignore simple-test-setup: these verification events and landing observations belong only to this test.
it("requires successful verification before merge and independently observed landing", () => {
	const verify = command(["check.ts"], 0, "bun");
	const merge = command(["merge"]);
	const state = {
		"main/commits": 1,
		"main/attributed": false,
		"main/value": "two\n",
		"task/exists": false,
	};
	expect(result("verify-land", [verify, merge], state).status).toBe(
		"uncovered",
	);
	expect(result("verify-land", [merge], state).status).toBe("fail");
	expect(result("verify-land", [merge, verify], state).status).toBe("fail");
	expect(
		result("verify-land", [{ ...verify, exitCode: 1 }, merge], state).status,
	).toBe("fail");
	expect(
		result(
			"verify-land",
			[verify, merge, command(["merge", "task/sample"], 1, "git")],
			state,
		).status,
	).toBe("fail");
	expect(
		result("verify-land", [verify, merge], { ...state, "main/commits": 2 })
			.status,
	).toBe("fail");
});

it("bridges a requested TODO to actual task ownership", () => {
	const show = command(["todo", "show", "1"]);
	const take = command([
		"add",
		"sample",
		"--todo",
		"1",
		"--goal",
		"Change value to two",
	]);
	const state = { "todo/takenBy": "sample", "task/exists": true };
	expect(result("requested-todo", [show, take], state).status).toBe("pass");
	expect(result("requested-todo", [take], state).status).toBe("fail");
	expect(result("requested-todo", [take, show], state).status).toBe("fail");
	expect(
		result("requested-todo", [show, take], {
			...state,
			"todo/takenBy": "other",
		}).status,
	).toBe("fail");
});

it("keeps conflict recovery explanation uncovered and forbids premature retry", () => {
	expect(result("recover-conflict", [file("write", "ARBOR.md")]).status).toBe(
		"uncovered",
	);
	expect(result("recover-conflict", []).status).toBe("fail");
	expect(
		result("recover-conflict", [
			file("write", "ARBOR.md"),
			command(["merge"], 2),
		]).status,
	).toBe("fail");
});

it("keeps failed-check explanation uncovered and forbids premature retry", () => {
	expect(
		result("recover-failed-check", [file("write", "ARBOR.md")]).status,
	).toBe("uncovered");
	expect(result("recover-failed-check", []).status).toBe("fail");
	expect(
		result("recover-failed-check", [
			file("write", "ARBOR.md"),
			command(["merge"], 3),
		]).status,
	).toBe("fail");
});

it("requires exhausted-budget escalation and rejects self-granted retries", () => {
	const state = { "task/status": "escalated" };
	expect(result("recover-budget", [], state).status).toBe("uncovered");
	expect(
		result("recover-budget", [], { "task/status": "working" }).status,
	).toBe("fail");
	expect(
		result("recover-budget", [command(["retry", "sample"], 1)], state).status,
	).toBe("fail");
	expect(result("recover-budget", [command(["merge"], 5)], state).status).toBe(
		"fail",
	);
});

it("requires moot removal and observed cleanup without landing", () => {
	const remove = command(["remove", "sample", "--reason", "moot"]);
	const state = { "task/exists": false, "main/value": "one\n" };
	expect(result("remove-moot", [remove], state).status).toBe("pass");
	expect(result("remove-moot", [], state).status).toBe("fail");
	expect(
		result("remove-moot", [remove, command(["merge"], 1)], state).status,
	).toBe("fail");
	expect(
		result("remove-moot", [remove], { ...state, "task/exists": true }).status,
	).toBe("fail");
});

it("executes seven real local CLI contracts without models or complete nested capture", async () => {
	const runs = await runProbes(
		{
			...lifecycle,
			probes: lifecycle.probes.filter(
				(probe) => probe.execution.kind === "cli",
			),
		},
		[{ adapter: cliAdapter, model: null }],
		{
			directory,
			parallel: 2,
			reps: 1,
			skillHash: "free-test",
			cliHash: "local-cli",
			reproduction: [],
		},
	);
	expect(
		runs.map((run) => ({
			id: run.probe.id,
			status: run.result.status,
			detail: run.result.detail,
			verdicts: run.result.verdicts.filter((item) => item.status !== "pass"),
		})),
	).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				id: "lifecycle/cli-working",
				status: "pass",
				verdicts: [],
			}),
			expect.objectContaining({
				id: "lifecycle/cli-merged",
				status: "pass",
				verdicts: [],
			}),
			expect.objectContaining({
				id: "lifecycle/cli-tests_failed",
				status: "pass",
				verdicts: [],
			}),
			expect.objectContaining({
				id: "lifecycle/cli-conflict",
				status: "pass",
				verdicts: [],
			}),
			expect.objectContaining({
				id: "lifecycle/cli-budget_exhausted",
				status: "pass",
				verdicts: [],
			}),
			expect.objectContaining({
				id: "lifecycle/cli-escalated",
				status: "pass",
				verdicts: [],
			}),
			expect.objectContaining({
				id: "lifecycle/cli-removed",
				status: "pass",
				verdicts: [],
			}),
		]),
	);
	expect(runs).toHaveLength(7);
	expect(runs.map((run) => run.run.evidence.complete)).not.toContainEqual(
		expect.arrayContaining(["events"]),
	);
	expect(runs.map((run) => run.run.usage.tokens)).toEqual([
		0, 0, 0, 0, 0, 0, 0,
	]);
}, 60000);

it("prepares all agent situations with an inert stand-in without claiming adherence", async () => {
	const runs = await runProbes(
		{
			...lifecycle,
			probes: lifecycle.probes.filter(
				(probe) => probe.execution.kind === "agent",
			),
		},
		[
			{
				model: "stand-in",
				adapter: {
					id: "inert-seed-check",
					version: "1",
					config: {},
					tokenBound: true,
					async run(context) {
						context.reply("No agent actions executed.");
					},
				},
			},
		],
		{
			directory,
			parallel: 2,
			reps: 1,
			skillHash: "free-test",
			cliHash: "local-cli",
			reproduction: [],
		},
	);
	expect(runs).toHaveLength(9);
	expect(
		runs.map((run) => ({
			id: run.probe.id,
			status: run.result.status,
			detail: run.result.detail,
		})),
	).not.toContainEqual(
		expect.objectContaining({ status: "infrastructure-error" }),
	);
	expect(runs.map((run) => run.result.status)).not.toContain("pass");
	expect(runs.map((run) => run.result.status)).not.toContain("bound");
}, 60000);

function result(
	id: string,
	events: Event[],
	state: Record<string, Json> = {},
	complete: Evidence["complete"] = ["events", "state"],
) {
	const probe = lifecycle.probes.find((item) => item.id === `lifecycle/${id}`);
	if (!probe) {
		throw new Error(`Missing lifecycle probe ${id}`);
	}
	return assess(probe, { events, state, complete, termination: "stop" });
}
function command(args: string[], exitCode = 0, name = "arbor"): Event {
	return {
		id: crypto.randomUUID(),
		actor: "agent",
		kind: "command",
		name,
		args,
		exitCode,
	};
}
function file(kind: "read" | "write", name: string): Event {
	return { id: crypto.randomUUID(), actor: "agent", kind, name, args: [] };
}
const add = () => command(["add", "sample", "--goal", "Change value to two"]);
const startState = { "task/base": "main", "main/value": "one\n" };
