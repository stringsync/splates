import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { decodeTask } from "@stringsync/splates-server/board";
import { FORMAT } from "@stringsync/splates-server/records";
import type { Assertion, Json, Match, Probe } from "./probe";
import { command, seedFile, seedRepository } from "./probe-sandbox";
import type { ProbeModule, Seed } from "./runner";

const source = ".agents/skills/splates/references/lanes.md";
const seed: Seed = {
	id: "orchestration/board",
	version: "1",
	fingerprint:
		"orchestration-board-v1:real-cli:queued-projection-v2:seedRepository-v1",
	async prepare(context, data) {
		await seedRepository(context);
		await seedFile(context, ".git/splates/format", `${FORMAT}\n`);
		const { commands } = data as { commands: string[][] };
		for (const args of commands) {
			const result = await command(context, ["splates", ...args]);
			if (result.exitCode !== 0) {
				throw new Error(result.stderr || result.stdout);
			}
		}
	},
	async observe(context) {
		const directory = join(context.isolation.repository, ".git/splates/tasks");
		const state: Record<string, Json> = {};
		let files: string[];
		try {
			files = await readdir(directory);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
				throw error;
			}
			files = [];
		}
		const queued = await Promise.all(
			files
				.filter((file) => /^\d+\.md$/.test(file))
				.map(async (file) => {
					const record = decodeTask(
						await readFile(join(directory, file), "utf8"),
					) as unknown as QueuedRecord;
					return {
						id: record.id,
						subject: record.subject,
						text: record.text,
						lane: record.lane ?? null,
						blockedBy: record.blockedBy,
						agent: record.assignee?.agent ?? null,
						model: record.assignee?.model ?? null,
					};
				}),
		);
		state.queued = queued.sort((left, right) => left.id - right.id);
		return state;
	},
};

const lane = ["lane", "add", "Widgets"];
const queue = (subject: string, text: string, ...flags: string[]) => [
	"task",
	"add",
	subject,
	text,
	"--agent",
	"fake",
	...flags,
];
const board = [
	lane,
	queue("Base", "Change base.ts", "--lane", "1"),
	queue("Other", "Change other.ts", "--lane", "1"),
];
const cmd = (args: string[], success = true): Match => ({
	actor: "agent",
	kind: "command",
	name: "splates",
	args,
	...(success ? { exitCode: 0 } : {}),
});
const required = (id: string, args: string[]): Assertion => ({
	id,
	kind: "count",
	match: cmd(args),
	min: 1,
});
const forbidden = (id: string, args: string[]): Assertion => ({
	id,
	kind: "count",
	match: cmd(args, false),
	min: 0,
	max: 0,
});
const before = (id: string, first: string[], second: string[]): Assertion => ({
	id,
	kind: "before",
	first: cmd(first),
	second: cmd(second),
});
const dispatch = (id: number) => [
	"add",
	`work-${id}`,
	"--task",
	String(id),
	"--agent",
	"fake",
	"--prompt",
	"Use the task detail.",
];
const gap: Assertion = {
	id: "capture-gap",
	kind: "uncovered",
	reason:
		"Requires complete native command/read/write capture. Exact argv checks cover only the declared forms; generic ACP is unsupported. A running lane starts no disabled worker, so no probe observes a lane starting its queued tasks.",
};
/** The cases rewritten when lanes came to run on their own, at version 2. */
const PLANNED = new Set([
	"independent",
	"dependency",
	"implicit-dependency",
	"shared-files",
	"triage",
	"added",
	"idle",
	"task-open",
	"task-done",
]);
function agent(
	id: string,
	requirement: string,
	input: string,
	commands: string[][],
	assertions: Assertion[],
): Probe {
	return {
		schema: 1,
		id: `orchestration/${id}`,
		version: PLANNED.has(id) ? "2" : "1",
		aspect: "orchestration",
		requirement: {
			id: requirement,
			text: input,
			source: requirement.startsWith("queue-")
				? ".agents/skills/splates/SKILL.md#queueing-tasks"
				: source,
		},
		seed: { id: seed.id, version: seed.version, data: { commands } },
		input: {
			kind: input.startsWith("[SPLATES") ? "directive" : "message",
			text: `${input}\n\nFixture boundary: fake is a disabled worker; do not execute workers. Use task names work-1/work-2 and dispatch prompt 'Use the task detail.' for these fixtures. Stop at the first decision/report boundary, without implementing the queued tasks.`,
			origin: /^\[SPLATES (IDLE|REPORT|TASK (DONE|OPEN|ADDED)|LANES DONE)/.test(
				input,
			)
				? "cli"
				: "user",
		},
		tools: ["splates", "read", "write"],
		evidence: ["events"],
		assertions: [...assertions, gap],
		stop: { kind: "reply" },
		bounds: { milliseconds: 30000, turns: 1, tokens: 2000 },
		execution: { kind: "agent", skill: ".agents/skills/splates/SKILL.md" },
	};
}
const run = ["lane", "run", "1"];
const link = ["task", "update", "2", "--blocked-by", "1"];
const probes: Probe[] = [
	agent("independent", "lanes-dispatch", "[SPLATES LANE 1]", board, [
		required("run-lane", run),
		before("inspect-before-run", ["lane", "show", "1"], run),
		forbidden("no-false-link", link),
		forbidden("no-dispatch-base", dispatch(1)),
		forbidden("no-dispatch-other", dispatch(2)),
	]),
	agent(
		"dependency",
		"lanes-dispatch",
		"[SPLATES LANE 1]",
		[...board, link],
		[required("run-lane", run), forbidden("no-dispatch-base", dispatch(1))],
	),
	agent(
		"implicit-dependency",
		"lanes-dispatch",
		"[SPLATES LANE 1]",
		[
			lane,
			board[1] as string[],
			queue(
				"Consumer",
				"Needs Base's new export from base.ts; cannot start until task 1 lands.",
				"--lane",
				"1",
			),
		],
		[
			required("link-dependency", link),
			before("link-before-run", link, run),
			forbidden("no-dispatch-consumer", dispatch(2)),
		],
	),
	agent(
		"shared-files",
		"lanes-dispatch",
		"[SPLATES LANE 1]\nBoth queued tasks replace the same API in base.ts; they need sequential work to avoid a hard rebase.",
		[
			lane,
			board[1] as string[],
			queue(
				"Replace API again",
				"Rewrite base.ts after Base lands.",
				"--lane",
				"1",
			),
		],
		[
			required("link-shared-files", link),
			before("link-before-run", link, run),
			forbidden("no-dispatch-first", dispatch(1)),
		],
	),
	agent(
		"triage",
		"lanes-dispatch",
		"[SPLATES LANE untriaged]\nPlace both queued tasks in Widgets; Other consumes Base, so link that dependency.",
		[lane, queue("Base", "Change base.ts"), queue("Other", "Consumes Base")],
		[
			required("place-base", ["task", "update", "1", "--lane", "1"]),
			required("place-other", ["task", "update", "2", "--lane", "1"]),
			required("link", link),
			before("triage-before-run", ["task", "update", "2", "--lane", "1"], run),
		],
	),
	agent(
		"taken-queued",
		"queue-groom",
		"[SPLATES TASK #1]\nA different worker owns this queued task. Inspect its ownership and report it.",
		[...board, ["add", "work-1", "--task", "1"]],
		[
			required("inspect-queued", ["task", "show", "1"]),
			forbidden("no-steal", ["task", "take", "1"]),
			forbidden("no-duplicate", dispatch(1)),
		],
	),
	agent(
		"added",
		"lanes-events",
		"[SPLATES TASK ADDED #3]\nYou orchestrate Widgets, which runs. Task 3 rewrites base.ts as Base does.",
		[
			...board,
			run,
			queue("Rewrite base", "Rewrite base.ts again.", "--lane", "1"),
		],
		[
			required("inspect-added", ["task", "show", "3"]),
			required("link-added", ["task", "update", "3", "--blocked-by", "1"]),
			forbidden("no-dispatch-added", dispatch(3)),
		],
	),
	agent(
		"idle",
		"lanes-events",
		"[SPLATES IDLE work-1]\nsplates already told it to carry on once, and nothing in the plan holds it back. Ask the user what becomes of it; do not wake it again.",
		[...board, run, ["add", "work-1", "--task", "1"]],
		[
			required("inspect-idle", ["show", "work-1"]),
			{
				id: "question",
				kind: "reply",
				type: "questions",
				field: ["questions", "0", "number"],
				equals: "1",
			},
			forbidden("no-claim", ["claim", "work-1"]),
		],
	),
	agent(
		"task-open",
		"lanes-events",
		"[SPLATES TASK OPEN #1]\nYou orchestrate Widgets, which the user paused.",
		board,
		[
			required("inspect-lane", ["lane", "show", "1"]),
			forbidden("leave-paused", run),
			forbidden("no-dispatch", dispatch(1)),
		],
	),
	agent(
		"task-done",
		"lanes-events",
		"[SPLATES TASK DONE #1]\nYou orchestrate Widgets, which the user paused; Base was removed as moot.",
		[...board, ["task", "remove", "1"]],
		[
			required("inspect-lane", ["lane", "show", "1"]),
			forbidden("leave-paused", run),
			forbidden("no-dispatch", dispatch(2)),
		],
	),
	agent(
		"report",
		"lanes-events",
		"[SPLATES REPORT work-1]\nYou orchestrate Widgets. Inspect the stopped task before deciding what can proceed.",
		[...board, ["add", "work-1", "--task", "1"]],
		[required("inspect-report", ["show", "work-1"])],
	),
	agent(
		"lanes-done",
		"lanes-events",
		"[SPLATES LANES DONE]\nYou orchestrated Widgets. Its last task was removed as moot; verify the board before a finished report.",
		[],
		[
			required("verify-lanes", ["lane", "list"]),
			required("verify-tasks", ["list"]),
			{
				id: "finished-format",
				kind: "reply",
				type: "report",
				field: ["report", "ending"],
				equals: "finished",
			},
			{ id: "empty-board", kind: "state", key: "queued", equals: [] },
		],
	),
	agent(
		"pivot",
		"lanes-events",
		"Drop work-1 and its queued task. Stop its worker with 'Drop this approach.' before removing it as moot.",
		[...board, ["add", "work-1", "--task", "1"]],
		[
			before(
				"stop-before-remove",
				["tell", "work-1", "--stop", "Drop this approach."],
				["remove", "work-1", "--reason", "moot"],
			),
			before(
				"remove-before-drop",
				["remove", "work-1", "--reason", "moot"],
				["task", "remove", "1"],
			),
		],
	),
	agent(
		"defer",
		"queue-defer",
		"[SPLATES DEFER] Add a widget. Preserve this entire detail: Change widget.ts and add a regression test. Name the task 'Add widget' with detail 'Change widget.ts and add a regression test.' and assign fake; leave it untriaged.",
		[],
		[
			required(
				"save-request",
				queue("Add widget", "Change widget.ts and add a regression test."),
			),
			{
				id: "no-investigation",
				kind: "count",
				match: { actor: "agent", kind: "read", name: "widget.ts" },
				min: 0,
				max: 0,
			},
			{
				id: "saved-detail",
				kind: "state",
				key: "queued",
				equals: [
					{
						id: 1,
						subject: "Add widget",
						text: "Change widget.ts and add a regression test.",
						lane: null,
						blockedBy: [],
						agent: "fake",
						model: null,
					},
				],
			},
		],
	),
];
// A direct CLI contract can pass on observed state even though nested events remain incomplete.
const cli: Probe = {
	...agent("cli-link", "queue-intake", "Link Other to Base", board, []),
	tools: [],
	evidence: ["state"],
	execution: {
		kind: "cli",
		command: ["splates", "task", "update", "2", "--blocked-by", "1"],
	},
	stop: {
		kind: "event",
		match: {
			actor: "cli",
			kind: "command",
			name: "splates",
			args: ["task", "update", "2", "--blocked-by", "1"],
			exitCode: 0,
		},
	},
	assertions: [
		{
			id: "linked-board",
			kind: "state",
			key: "queued",
			equals: [
				{
					id: 1,
					subject: "Base",
					text: "Change base.ts",
					lane: 1,
					blockedBy: [],
					agent: "fake",
					model: null,
				},
				{
					id: 2,
					subject: "Other",
					text: "Change other.ts",
					lane: 1,
					blockedBy: [1],
					agent: "fake",
					model: null,
				},
			],
		},
	],
};
// State/reply assertions declare their channels independently of event assertions.
for (const probe of probes) {
	if (probe.assertions.some((assertion) => assertion.kind === "state")) {
		probe.evidence.push("state");
	}
	if (probe.assertions.some((assertion) => assertion.kind === "reply")) {
		probe.evidence.push("reply");
	}
}
export default {
	probes: [...probes, cli],
	seeds: [seed],
} satisfies ProbeModule;

/** What `observe` reads of a queued task's record. */
interface QueuedRecord {
	id: number;
	subject: string;
	text: string;
	lane?: number | null;
	blockedBy: number[];
	assignee?: { agent: string; model?: string };
}
