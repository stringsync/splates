import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { decodeTask } from "@stringsync/splates-server/board";
import { FORMAT } from "@stringsync/splates-server/records";
import type { Assertion, Json, Match, Probe } from "./probe";
import { command, seedFile, seedRepository } from "./probe-sandbox";
import type { ProbeModule, Seed } from "./runner";

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
		"Requires complete native command/read/write capture. Exact argv checks cover only the declared forms; generic ACP is unsupported.",
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
			source: ".agents/skills/splates/SKILL.md#queueing-tasks",
		},
		seed: { id: seed.id, version: seed.version, data: { commands } },
		input: {
			kind: input.startsWith("[SPLATES") ? "directive" : "message",
			text: `${input}\n\nFixture boundary: fake is a disabled worker; do not execute workers. Use task names work-1/work-2 and dispatch prompt 'Use the task detail.' for these fixtures. Stop at the first decision/report boundary, without implementing the queued tasks.`,
			origin: "user",
		},
		tools: ["splates", "read", "write"],
		evidence: ["events"],
		assertions: [...assertions, gap],
		stop: { kind: "reply" },
		bounds: { milliseconds: 30000, turns: 1, tokens: 2000 },
		execution: { kind: "agent", skill: ".agents/skills/splates/SKILL.md" },
	};
}
const probes: Probe[] = [
	agent(
		"taken-queued",
		"queue-groom",
		"[SPLATES TASK #1]\nA different worker owns this queued task. Inspect its ownership and report it.",
		[...board, ["add", "work-1", "--task", "1"]],
		[
			required("inspect-queued", ["task", "show", "1"]),
			forbidden("no-duplicate", dispatch(1)),
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
