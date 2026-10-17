import { createHash } from "node:crypto";
import { cp, readFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import type { Assertion, Match, Probe } from "./probe";
import { command, seedFile, seedRepository } from "./probe-sandbox";
import type { ProbeModule, Seed } from "./runner";

const root = ".agents/skills/arbor/SKILL.md";
const source = join(import.meta.dir, "../..");

/** Match a complete skill/reference read certified by a trusted adapter; see DISCOVERY.md. */
export function completeRead(path: string): Match {
	return {
		actor: "agent",
		kind: "read",
		name: path,
		payload: { delivered: "complete" },
	};
}

const gap: Assertion = {
	id: "visibility/native-discovery",
	kind: "uncovered",
	reason:
		"Native skill activation, delivered byte coverage, canonical paths and all-tool read/action ordering need an instrumented adapter. Generic ACP injects the root skill and rejects tools; synthetic certificates do not prove adherence.",
};

function probe(
	id: string,
	text: string,
	file: string,
	action: Match,
	extra: Assertion[] = [],
): Probe {
	return {
		schema: 1,
		id: `discovery/${id}`,
		version: "1",
		aspect: "discovery",
		requirement: {
			id: `discovery-${id}`,
			text: `Discover and fully load ${file} before the dependent action.`,
			source: `${root}#Reference files; ${file}`,
		},
		seed: { id: "discovery/repository", version: "1", data: { case: id } },
		input: {
			kind: text.startsWith("[ARBOR") ? "directive" : "message",
			text,
			origin: "user",
		},
		tools: ["read", "write", "shell"],
		evidence: ["events", "state", "reply"],
		assertions: [
			{
				id: "discovery/root",
				kind: "count",
				match: completeRead(root),
				min: 1,
			},
			{
				id: "disclosure/required-file",
				kind: "count",
				match: completeRead(file),
				min: 1,
			},
			{
				id: "disclosure/read-before-action",
				kind: "before",
				first: completeRead(file),
				second: action,
			},
			{ id: "adherence/action", kind: "count", match: action, min: 1 },
			...extra,
			gap,
		],
		stop: { kind: "reply" },
		bounds: { milliseconds: 30000, turns: 1, tokens: 2000 },
		execution: { kind: "agent", skill: "arbor" },
	};
}

const codeRead: Match = {
	actor: "agent",
	kind: "read",
	name: "src/message.ts",
};
const invocation = (args: string[]): Match => ({
	actor: "agent",
	kind: "command",
	name: "arbor",
	args,
	exitCode: 0,
});
const lifecycle: Assertion[] = [
	{
		id: "adherence/add-before-investigation",
		kind: "before",
		first: invocation(["add", "message", "--goal", "Fix the greeting"]),
		second: codeRead,
	},
	{
		id: "adherence/isolation-planning",
		kind: "uncovered",
		reason:
			"Task worktree cwd and a meaningful plan before writes require trusted lifecycle observations (#339); a read certificate does not establish them.",
	},
	{
		id: "adherence/no-main-write",
		kind: "count",
		match: { actor: "agent", kind: "write", name: "main:src/message.ts" },
		min: 0,
		max: 0,
	},
];

const probes: Probe[] = [
	probe(
		"implicit",
		"Fix the greeting in src/message.ts. Use message as the task name and Fix the greeting as its goal.",
		root,
		codeRead,
		lifecycle,
	),
	probe(
		"explicit",
		"Use $arbor to fix the greeting in src/message.ts. Use message as the task name and Fix the greeting as its goal.",
		root,
		codeRead,
		lifecycle,
	),
	...[
		[
			"todos",
			'Record a follow-up using `arbor todo add "Fix greeting" "Correct the greeting typo" --agent fake --model none`; do not implement it.',
			"todos.md",
			[
				"todo",
				"add",
				"Fix greeting",
				"Correct the greeting typo",
				"--agent",
				"fake",
				"--model",
				"none",
			],
		],
		[
			"parts",
			"Create a code-changing child of the current task using `arbor add child --base task/message`.",
			"parts.md",
			["add", "child", "--base", "task/message"],
		],
		[
			"handoff",
			"[ARBOR HANDOFF TO codex gpt-6-astra]",
			"handoff.md",
			["handoff", "message", "--agent", "codex", "--model", "gpt-6-astra"],
		],
		["checkpoint", "[ARBOR CHECKPOINT]", "checkpoint.md", ["show", "message"]],
		["setup", "[ARBOR SETUP agents]", "setup.md", ["agents"]],
	].map(([id, text, reference, args]) =>
		probe(
			id as string,
			text as string,
			`.agents/skills/arbor/references/${reference}`,
			id === "checkpoint"
				? { actor: "agent", kind: "write", name: "task/message/ARBOR.md" }
				: {
						actor: "agent",
						kind: "command",
						name: "arbor",
						args: args as string[],
					},
			[
				{
					id: "visibility/action-variants",
					kind: "uncovered",
					reason:
						"Canonical argv shown here is a narrow witness, not all valid action variants or the full workflow. Reference ordering integration belongs to #340/#356/#357; checkpoint write is a plan-update witness, not checkpoint completion.",
				},
			],
		),
	),
	...[
		["nested", "Applicable repository instructions from a nested starting cwd"],
		[
			"symlink",
			"Native supported skill symlink discovery and relative reference resolution",
		],
		[
			"root-truncated",
			"Truncated root, including instructions beyond the delivered cutoff",
		],
		[
			"reference-truncated",
			"Truncated reference with incomplete disclosure before dependent action",
		],
		[
			"chunk-recovery",
			"Complete ordered chunk recovery, overlapping chunks and long output",
		],
		["missing", "Missing required file versus omitted read"],
		["unreadable", "Permission-denied required file versus omitted read"],
		["later-turn", "Later-turn disclosure in the same actual conversation"],
		[
			"resumed",
			"Fresh-process resume stand-in versus actual compacted-session disclosure",
		],
	].map(([id, reason]) =>
		probe(
			id as string,
			"Fix the greeting in src/message.ts. Use message as the task name and Fix the greeting as its goal.",
			root,
			codeRead,
			[
				{
					id: "visibility/scenario",
					kind: "uncovered",
					reason: `${reason}: scenario requires adapter-controlled delivery/session/cwd capabilities absent from the bundled adapters. This is a registered gap, not an executed variation.`,
				},
			],
		),
	),
];

const seed: Seed = {
	id: "discovery/repository",
	version: "1",
	// Hash the module, helpers and copied instructions at prepare time as well.
	fingerprint:
		"discovery/repository/v1; discovery.probes.ts; probe-sandbox.ts; repository instructions snapshot",
	async prepare(context) {
		await seedRepository(context);
		await seedFile(
			context,
			"AGENTS.md",
			await readFile(join(source, "AGENTS.md"), "utf8"),
		);
		await symlink("AGENTS.md", join(context.isolation.repository, "CLAUDE.md"));
		await cp(
			join(source, ".agents/skills/arbor"),
			join(context.isolation.repository, ".agents/skills/arbor"),
			{ recursive: true, dereference: true },
		);
		await seedFile(
			context,
			"src/message.ts",
			'export const greeting = "helo";\n',
		);
		const digest = createHash("sha256");
		for (const path of [
			"AGENTS.md",
			root,
			"evals/arbor-skill/discovery.probes.ts",
			"evals/arbor-skill/probe-sandbox.ts",
		]) {
			digest.update(path).update(await readFile(join(source, path)));
		}
		context.trace({ discoverySeedSnapshot: digest.digest("hex") });
		for (const argv of [
			["git", "add", "."],
			["git", "commit", "-qm", "Seed repository discovery inputs"],
		]) {
			const result = await command(context, argv);
			if (result.exitCode !== 0) {
				throw new Error(result.stderr);
			}
		}
	},
	async observe() {
		return {};
	},
};

export default { probes, seeds: [seed] } satisfies ProbeModule;

/** Verify bytes actually delivered by a trusted tool boundary against a snapshot.
 * Call once per disclosure segment; do not combine reads across dependent actions.
 * Reading the filesystem in the grader is not proof the agent received these bytes.
 */
export function deliveredCoverage(
	expected: Uint8Array,
	chunks: { offset: number; bytes: Uint8Array }[],
): boolean {
	if (chunks.length === 0) {
		return false;
	}
	const covered = new Uint8Array(expected.length);
	for (const { offset, bytes } of chunks) {
		if (
			!Number.isSafeInteger(offset) ||
			offset < 0 ||
			offset + bytes.length > expected.length
		) {
			return false;
		}
		for (let index = 0; index < bytes.length; index++) {
			if (bytes[index] !== expected[offset + index]) {
				return false;
			}
			covered[offset + index] = 1;
		}
	}
	return covered.every((value) => value === 1);
}
