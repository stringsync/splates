import { lifecycleGoal as goal, lifecycleSeed } from "./lifecycle-seed";
import type { Assertion, Json, Match, Probe } from "./probe";
import type { ProbeModule } from "./runner";

const skill = ".agents/skills/arbor/SKILL.md";
const cmd = (args: string[], exitCode?: number): Match => ({
	actor: "agent",
	kind: "command",
	name: "arbor",
	args,
	...(exitCode === undefined ? {} : { exitCode }),
});
const action = (kind: "read" | "write", name: string): Match => ({
	actor: "agent",
	kind,
	name,
});
const required = (id: string, match: Match): Assertion => ({
	id,
	kind: "count",
	match,
	min: 1,
});
const before = (id: string, first: Match, second: Match): Assertion => ({
	id,
	kind: "before",
	first,
	second,
});
const forbidden = (id: string, match: Match): Assertion => ({
	id,
	kind: "count",
	match,
	min: 0,
	max: 0,
});
const state = (id: string, key: string, equals: Json): Assertion => ({
	id,
	kind: "state",
	key,
	equals,
});
const gap = (id: string, reason: string): Assertion => ({
	id,
	kind: "uncovered",
	reason,
});

function agent(
	id: string,
	requirement: string,
	section: string,
	situation: string,
	input: string,
	assertions: Assertion[],
): Probe {
	return {
		schema: 1,
		id: `lifecycle/${id}`,
		version: "1",
		aspect: "lifecycle",
		requirement: {
			id: requirement,
			text: input,
			source: `${skill}#${section}`,
		},
		seed: { id: "lifecycle/local", version: "1", data: { situation } },
		input: {
			kind: input.startsWith("[ARBOR") ? "directive" : "message",
			text: input,
			origin: "user",
		},
		tools: ["exec", "read", "write"],
		evidence: ["events", "state"],
		assertions,
		stop: { kind: "reply" },
		bounds: { milliseconds: 30000, turns: 1, tokens: 2000 },
		execution: { kind: "agent", skill },
	};
}

const add = cmd(["add", "sample", "--goal", goal], 0);
const claim = cmd(["claim", "sample"], 0);
const read = action("read", "value.txt");
const edit = action("write", "value.txt");
const merge = cmd(["merge"], 0);
const probes: Probe[] = [
	agent(
		"start",
		"lifecycle-start",
		"Workflow",
		"fresh",
		'Change value.txt from one to two. Use task name sample and goal "Change value to two". Stop after the first project-file read, before editing.',
		[
			before("Workflow/add-before-investigation", add, read),
			state("Workflow/task-base", "task/base", "main"),
			state("Workflow/main-untouched", "main/value", "one\n"),
			forbidden("Workflow/no-early-edit", edit),
			gap(
				"Workflow/read-scope",
				"Requires all project reads and their cwd, including nested tools; the schema's file name alone does not prove worktree isolation or exclude other early reads.",
			),
		],
	),
	agent(
		"claim",
		"lifecycle-start",
		"Directives",
		"task",
		"[ARBOR TASK sample]\nResume the task and inspect value.txt, then stop before editing.",
		[
			before("TASK/claim-before-plan-read", claim, action("read", "ARBOR.md")),
			before("TASK/claim-before-code-read", claim, read),
			state("TASK/working", "task/status", "working"),
			forbidden("TASK/no-new-task", cmd(["add", "sample", "--goal", goal])),
		],
	),
	agent(
		"plan",
		"lifecycle-plan",
		"ARBOR.md",
		"task",
		"[ARBOR TASK sample]\nChange value.txt from one to two. Stop after that edit; do not commit or merge yet.",
		[
			before("Workflow/plan-before-edit", action("write", "ARBOR.md"), edit),
			before("Workflow/overlap-before-edit", cmd(["list", "--files"], 0), edit),
			state("Workflow/main-untouched", "main/value", "one\n"),
			forbidden("Workflow/no-premature-merge", cmd(["merge"])),
			gap(
				"ARBOR.md/plan-content",
				"Write ordering does not prove required sections were present at the first edit, or that the plan was useful; requires a captured write snapshot.",
			),
		],
	),
	agent(
		"verify-land",
		"lifecycle-land",
		"Committing",
		"ready",
		"[ARBOR TASK sample]\nThe trivial change is committed. Verify with `bun check.ts` and land the task. No review is requested.",
		[
			before(
				"Workflow/verify-before-merge",
				{
					actor: "agent",
					kind: "command",
					name: "bun",
					args: ["check.ts"],
					exitCode: 0,
				},
				merge,
			),
			required("Workflow/arbor-merge", merge),
			state("Committing/one-commit", "main/commits", 1),
			state("Committing/no-attribution", "main/attributed", false),
			state("Workflow/landed-value", "main/value", "two\n"),
			state("Workflow/worktree-removed", "task/exists", false),
			forbidden("Workflow/no-raw-merge", {
				actor: "agent",
				kind: "command",
				name: "git",
				args: ["merge", "task/sample"],
			}),
			gap(
				"Workflow/argv-variants",
				"Forbidden selector covers the exact raw git argv only, not every git merge/reset/update-ref form; complete mutation classification is unavailable.",
			),
		],
	),
	agent(
		"requested-todo",
		"lifecycle-start",
		"Directives",
		"todo",
		'[ARBOR TODO #1]\nUse task name sample and goal "Change value to two". Stop after creating its worktree, before code investigation.',
		[
			before(
				"TODO/show-before-add",
				cmd(["todo", "show", "1"], 0),
				cmd(["add", "sample", "--todo", "1", "--goal", goal], 0),
			),
			state("TODO/taken-by-task", "todo/takenBy", "sample"),
			state("TODO/task-exists", "task/exists", true),
		],
	),
	...(["conflict", "failed-check", "budget"] as const).map((situation) =>
		agent(
			`recover-${situation}`,
			"lifecycle-recovery",
			"Workflow",
			situation,
			`[ARBOR TASK sample]\nA previous merge stopped with ${situation === "failed-check" ? "tests_failed" : situation === "budget" ? "budget_exhausted" : "conflict"}. Inspect the local state and follow the CLI recovery instructions. ${situation === "budget" ? "Escalate; do not grant yourself retries." : "Record the failed attempt in ARBOR.md and stop before attempting another merge."}`,
			situation === "budget"
				? [
						state("Escalation/exhausted-task", "task/status", "escalated"),
						forbidden("Workflow/no-self-retry", cmd(["retry", "sample"])),
						forbidden("Workflow/no-exhausted-merge", cmd(["merge"])),
						gap(
							"Escalation/report-detail",
							"A status does not establish an accurate per-attempt explanation or all retry argv variants.",
						),
					]
				: [
						required("Workflow/record-failure", action("write", "ARBOR.md")),
						forbidden("Workflow/no-premature-retry", cmd(["merge"])),
						gap(
							"Workflow/follow-stderr",
							"An ARBOR.md write cannot establish that the recorded failure and proposed recovery match stderr; no natural-language surrogate grades that claim.",
						),
					],
		),
	),
	agent(
		"remove-moot",
		"lifecycle-cleanup",
		"Workflow",
		"task",
		"[ARBOR TASK sample]\nThe requested change is obsolete. There are no associated todos. Remove this task as moot and report the outcome.",
		[
			required(
				"Workflow/remove-moot",
				cmd(["remove", "sample", "--reason", "moot"], 0),
			),
			state("Workflow/no-worktree", "task/exists", false),
			state("Workflow/main-unchanged", "main/value", "one\n"),
			forbidden("Workflow/no-moot-merge", cmd(["merge"])),
		],
	),
];

// The wrapper execs the real CLI from the seeded task. Its own exit is the CLI exit,
// but nested process/read/write events remain incomplete, just as cliAdapter declares.
for (const [situation, args, expected] of [
	["task", ["claim", "sample"], "working"],
	["ready", ["merge"], "merged"],
	["failed-check", ["merge"], "tests_failed"],
	["conflict", ["merge"], "conflict"],
	["budget", ["merge"], "budget_exhausted"],
	["task", ["escalate", "Need user decision"], "escalated"],
	["task", ["remove", "sample", "--reason", "moot"], "removed"],
] as const) {
	const failure = ["tests_failed", "conflict", "budget_exhausted"].includes(
		expected,
	);
	probes.push({
		schema: 1,
		id: `lifecycle/cli-${expected}`,
		version: "1",
		aspect: "lifecycle",
		requirement: {
			id: failure ? "lifecycle-recovery" : "lifecycle-land",
			text: `Real local CLI ${args.join(" ")}: ${expected}`,
			source: `${skill}#Workflow`,
		},
		seed: { id: "lifecycle/local", version: "1", data: { situation } },
		input: { kind: "message", text: args.join(" "), origin: "user" },
		tools: [],
		evidence: ["state"],
		assertions: [
			state(
				"CLI/exit",
				"cli/exit",
				expected === "conflict"
					? 2
					: expected === "tests_failed"
						? 3
						: expected === "budget_exhausted"
							? 5
							: 0,
			),
			...(failure
				? [
						state("CLI/reason", "cli/reason", expected),
						state("CLI/recovery-guidance", "cli/guidance", true),
					]
				: [state("CLI/state", "task/status", expected)]),
			...(expected === "merged" || expected === "removed"
				? [
						state("CLI/cleanup", "task/exists", false),
						state("CLI/record-removed", "task/record", false),
						state("CLI/branch-removed", "task/branch", false),
					]
				: []),
			...(expected === "merged"
				? [
						state("CLI/landed", "main/value", "two\n"),
						state("CLI/one-commit", "main/commits", 1),
					]
				: []),
		],
		stop: {
			kind: "event",
			match: {
				actor: "cli",
				kind: "command",
				name: "lifecycle-arbor",
				args: [...args],
			},
		},
		bounds: { milliseconds: 30000, turns: 1, tokens: 1 },
		execution: { kind: "cli", command: ["lifecycle-arbor", ...args] },
	});
}

export default { probes, seeds: [lifecycleSeed] } satisfies ProbeModule;
