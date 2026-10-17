import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
// biome-ignore lint/style/noRestrictedImports: fixture format must follow production; no public format export exists.
import { FORMAT } from "../../packages/arbor/format";
import type { Assertion, Json, Match, Probe } from "./probe";
import { command, seedFile, seedRepository } from "./probe-sandbox";
import type { ProbeModule, Seed } from "./runner";

const source = ".agents/skills/arbor/references/lanes.md";
const seed: Seed = {
	id: "orchestration/board",
	version: "1",
	fingerprint:
		"orchestration-board-v1:real-cli:todo-projection-v1:seedRepository-v1",
	async prepare(context, data) {
		await seedRepository(context);
		await seedFile(context, ".git/arbor/format", `${FORMAT}\n`);
		const { commands } = data as { commands: string[][] };
		for (const args of commands) {
			const result = await command(context, ["arbor", ...args]);
			if (result.exitCode !== 0) {
				throw new Error(result.stderr || result.stdout);
			}
		}
	},
	async observe(context) {
		const directory = join(context.isolation.repository, ".git/arbor/todos");
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
		const todos = await Promise.all(
			files
				.filter((file) => /^\d+\.json$/.test(file))
				.map(async (file) => {
					const todo = JSON.parse(
						await readFile(join(directory, file), "utf8"),
					);
					return {
						id: todo.id,
						subject: todo.subject,
						text: todo.text,
						lane: todo.lane ?? null,
						blockedBy: todo.blockedBy,
						agent: todo.assignee?.agent ?? null,
						model: todo.assignee?.model ?? null,
					};
				}),
		);
		state.todos = todos.sort((left, right) => left.id - right.id);
		return state;
	},
};

const lane = ["lane", "add", "Widgets"];
const todo = (subject: string, text: string, ...flags: string[]) => [
	"todo",
	"add",
	subject,
	text,
	"--agent",
	"fake",
	...flags,
];
const board = [
	lane,
	todo("Base", "Change base.ts", "--lane", "1"),
	todo("Other", "Change other.ts", "--lane", "1"),
];
const cmd = (args: string[], success = true): Match => ({
	actor: "agent",
	kind: "command",
	name: "arbor",
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
	"--todo",
	String(id),
	"--agent",
	"fake",
	"--prompt",
	"Use the todo detail.",
];
const gap: Assertion = {
	id: "capture-gap",
	kind: "uncovered",
	reason:
		"Requires complete native command/read/write capture. Exact argv checks cover only the declared forms; generic ACP is unsupported. Worker dispatch is a disabled stand-in, not actual delegated execution or adherence.",
};
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
		version: "1",
		aspect: "orchestration",
		requirement: {
			id: requirement,
			text: input,
			source: requirement.startsWith("todos-")
				? ".agents/skills/arbor/SKILL.md#todos"
				: source,
		},
		seed: { id: seed.id, version: seed.version, data: { commands } },
		input: {
			kind: input.startsWith("[ARBOR") ? "directive" : "message",
			text: `${input}\n\nFixture boundary: fake is a disabled worker; do not execute workers. Use task names work-1/work-2 and dispatch prompt 'Use the todo detail.' for these fixtures. Stop at the first decision/report boundary, without implementing the todos.`,
			origin: /^\[ARBOR (IDLE|REPORT|STOPPED|TODO (DONE|OPEN)|LANES DONE)/.test(
				input,
			)
				? "cli"
				: "user",
		},
		tools: ["arbor", "read", "write"],
		evidence: ["events"],
		assertions: [...assertions, gap],
		stop: { kind: "reply" },
		bounds: { milliseconds: 30000, turns: 1, tokens: 2000 },
		execution: { kind: "agent", skill: ".agents/skills/arbor/SKILL.md" },
	};
}
const probes: Probe[] = [
	agent("independent", "lanes-dispatch", "[ARBOR LANE 1]", board, [
		required("dispatch-base", dispatch(1)),
		required("dispatch-other", dispatch(2)),
		before("inspect-before-dispatch", ["lane", "show", "1"], dispatch(1)),
	]),
	agent(
		"dependency",
		"lanes-dispatch",
		"[ARBOR LANE 1]",
		[...board, ["todo", "update", "2", "--blocked-by", "1"]],
		[
			required("dispatch-base", dispatch(1)),
			forbidden("hold-dependent", dispatch(2)),
		],
	),
	agent(
		"implicit-dependency",
		"lanes-dispatch",
		"[ARBOR LANE 1]",
		[
			lane,
			board[1] as string[],
			todo(
				"Consumer",
				"Needs Base's new export from base.ts; cannot start until todo 1 lands.",
				"--lane",
				"1",
			),
		],
		[
			required("link-dependency", ["todo", "update", "2", "--blocked-by", "1"]),
			forbidden("hold-consumer", dispatch(2)),
		],
	),
	agent(
		"shared-files",
		"lanes-dispatch",
		"[ARBOR LANE 1]\nBoth todos replace the same API in base.ts; they need sequential work to avoid a hard rebase.",
		[
			lane,
			board[1] as string[],
			todo(
				"Replace API again",
				"Rewrite base.ts after Base lands.",
				"--lane",
				"1",
			),
		],
		[
			required("dispatch-first", dispatch(1)),
			forbidden("hold-conflicting", dispatch(2)),
		],
	),
	agent(
		"triage",
		"lanes-dispatch",
		"[ARBOR LANE untriaged]\nPlace both todos in Widgets; Other consumes Base, so link that dependency.",
		[lane, todo("Base", "Change base.ts"), todo("Other", "Consumes Base")],
		[
			required("place-base", ["todo", "update", "1", "--lane", "1"]),
			required("place-other", ["todo", "update", "2", "--lane", "1"]),
			required("link", ["todo", "update", "2", "--blocked-by", "1"]),
			before(
				"triage-before-dispatch",
				["todo", "update", "2", "--lane", "1"],
				dispatch(1),
			),
		],
	),
	agent(
		"taken-todo",
		"todos-groom",
		"[ARBOR TODO #1]\nA different worker owns this todo. Inspect its ownership and report it.",
		[...board, ["add", "work-1", "--todo", "1"]],
		[
			required("inspect-todo", ["todo", "show", "1"]),
			forbidden("no-steal", ["todo", "take", "1"]),
			forbidden("no-duplicate", dispatch(1)),
		],
	),
	agent(
		"idle",
		"lanes-events",
		"[ARBOR IDLE work-1]\nThis is its first idle notification. Resume it with the message 'Continue to merge, remove or escalate.'",
		[...board, ["add", "work-1", "--todo", "1"]],
		[
			before(
				"inspect-before-wake",
				["show", "work-1"],
				["tell", "work-1", "Continue to merge, remove or escalate."],
			),
		],
	),
	agent(
		"idle-again",
		"lanes-events",
		"[ARBOR IDLE work-1]\nThis is the second unchanged idle notification after you already told it to continue. Ask the user what becomes of it; do not wake it again.",
		[...board, ["add", "work-1", "--todo", "1"]],
		[
			required("inspect-idle", ["show", "work-1"]),
			{
				id: "question",
				kind: "reply",
				type: "questions",
				field: ["questions", "0", "number"],
				equals: "1",
			},
			forbidden("no-repeat-wake", [
				"tell",
				"work-1",
				"Continue to merge, remove or escalate.",
			]),
		],
	),
	agent(
		"todo-open",
		"lanes-events",
		"[ARBOR TODO OPEN #1]\nYou orchestrate Widgets. Re-read the lane and hand out the ready work.",
		board,
		[before("refresh-before-dispatch", ["lane", "show", "1"], dispatch(1))],
	),
	agent(
		"todo-done",
		"lanes-events",
		"[ARBOR TODO DONE #1]\nYou orchestrate Widgets; Base was removed as moot. Refresh the lane before dispatching Other.",
		[...board, ["todo", "remove", "1"]],
		[before("refresh-before-dispatch", ["lane", "show", "1"], dispatch(2))],
	),
	agent(
		"report",
		"lanes-events",
		"[ARBOR REPORT work-1]\nYou orchestrate Widgets. Inspect the stopped task before deciding what can proceed.",
		[...board, ["add", "work-1", "--todo", "1"]],
		[required("inspect-report", ["show", "work-1"])],
	),
	agent(
		"stopped",
		"lanes-events",
		"[ARBOR STOPPED work-1]\nYou orchestrate Widgets. The user stopped its worker. Inspect the task; leave its disposition to the user.",
		[...board, ["add", "work-1", "--todo", "1"]],
		[
			required("inspect-stopped", ["show", "work-1"]),
			forbidden("no-unrequested-removal", [
				"remove",
				"work-1",
				"--reason",
				"moot",
			]),
		],
	),
	agent(
		"lanes-done",
		"lanes-events",
		"[ARBOR LANES DONE]\nYou orchestrated Widgets. Its last todo was removed as moot; verify the board before a finished report.",
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
			{ id: "empty-board", kind: "state", key: "todos", equals: [] },
		],
	),
	agent(
		"pivot",
		"lanes-events",
		"Drop work-1 and its todo. Stop its worker with 'Drop this approach.' before removing it as moot.",
		[...board, ["add", "work-1", "--todo", "1"]],
		[
			before(
				"stop-before-remove",
				["tell", "work-1", "--stop", "Drop this approach."],
				["remove", "work-1", "--reason", "moot"],
			),
			before(
				"remove-before-drop",
				["remove", "work-1", "--reason", "moot"],
				["todo", "remove", "1"],
			),
		],
	),
	agent(
		"defer",
		"todos-defer",
		"[ARBOR DEFER] Add a widget. Preserve this entire detail: Change widget.ts and add a regression test. Name the todo 'Add widget' with detail 'Change widget.ts and add a regression test.' and assign fake; leave it untriaged.",
		[],
		[
			required(
				"save-request",
				todo("Add widget", "Change widget.ts and add a regression test."),
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
				key: "todos",
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
	...agent("cli-link", "todos-intake", "Link Other to Base", board, []),
	tools: [],
	evidence: ["state"],
	execution: {
		kind: "cli",
		command: ["arbor", "todo", "update", "2", "--blocked-by", "1"],
	},
	stop: {
		kind: "event",
		match: {
			actor: "cli",
			kind: "command",
			name: "arbor",
			args: ["todo", "update", "2", "--blocked-by", "1"],
			exitCode: 0,
		},
	},
	assertions: [
		{
			id: "linked-board",
			kind: "state",
			key: "todos",
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
