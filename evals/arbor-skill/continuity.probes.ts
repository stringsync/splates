import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	CHECK_IN,
	CHECKPOINT,
	RECONNECT,
	RESUME,
	// biome-ignore lint/style/noRestrictedImports: Production directive contract has no public export.
} from "../../packages/arbor/prompts";
import type { Assertion, Match, Probe } from "./probe";
import { command, seedRepository } from "./probe-sandbox";
import { hash, type ProbeModule, type RunContext, type Seed } from "./runner";

const task = "continuity";
const plan = `# continuity

## Goal

Write result.txt with exactly ready followed by a newline.

## Done

- [x] Established the required output.

## Next

- [ ] Write result.txt.

## Notes

Paused before writing result.txt. Continue that step only, then stop before verification or landing.

## Assumptions

## Blocked
`;

async function checked(context: RunContext, argv: string[]) {
	const result = await command(context, argv);
	if (result.exitCode !== 0) {
		throw new Error(result.stderr || result.stdout);
	}
	return result.stdout.trim();
}
async function file(path: string): Promise<string | null> {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return null;
		}
		throw error;
	}
}

const seed: Seed = {
	id: "continuity/task",
	version: "1",
	fingerprint: hash([
		readFileSync(import.meta.path, "utf8"),
		readFileSync(join(import.meta.dir, "probe-sandbox.ts"), "utf8"),
	]),
	async prepare(context, data) {
		if (
			typeof data !== "string" ||
			![
				"checkpoint",
				"resume",
				"completed",
				"partial",
				"failed",
				"update",
				"removed",
			].includes(data)
		) {
			throw new Error("Unknown continuity seed");
		}
		await seedRepository(context);
		// Seed the current empty record format without network-backed skill installation.
		await mkdir(join(context.isolation.repository, ".git/arbor"), {
			recursive: true,
		});
		await writeFile(
			join(context.isolation.repository, ".git/arbor/format"),
			"1\n",
		);
		await checked(context, [
			"arbor",
			"add",
			task,
			"--goal",
			"Write result.txt with ready",
		]);
		const path = await checked(context, ["arbor", "path", task]);
		context.runtime.taskPath = path;
		await writeFile(
			join(path, "ARBOR.md"),
			plan +
				(data === "checkpoint"
					? "\nOpen question: Which output label should follow ready?\n"
					: ""),
		);
		if (data === "completed" || data === "partial") {
			await writeFile(
				join(path, "result.txt"),
				data === "completed" ? "ready\n" : "rea",
			);
		}
		if (data === "removed") {
			await checked(context, ["arbor", "remove", task, "--reason", "moot"]);
		}
	},
	async observe(context) {
		const path = context.runtime.taskPath;
		if (typeof path !== "string") {
			throw new Error("Missing task path");
		}
		const notes = await file(join(path, "ARBOR.md"));
		return {
			"file/result.txt": await file(join(path, "result.txt")),
			"file/ARBOR.md": notes,
			"plan/changed":
				notes !== null &&
				notes !== plan &&
				notes !==
					`${plan}\nOpen question: Which output label should follow ready?\n`,
			"plan/sections":
				notes !== null &&
				["Done", "Next", "Notes", "Blocked"].every((heading) =>
					notes.includes(`## ${heading}\n`),
				),
		};
	},
};
const read = (name: string): Match => ({ actor: "agent", kind: "read", name });
const write = (name: string): Match => ({
	actor: "agent",
	kind: "write",
	name,
});
const gap = (id: string, reason: string): Assertion => ({
	id,
	kind: "uncovered",
	reason,
});
const count = (id: string, match: Match, min = 1, max?: number): Assertion => ({
	id,
	kind: "count",
	match,
	min,
	...(max === undefined ? {} : { max }),
});
const state = (
	id: string,
	key: string,
	equals: string | boolean | null,
): Assertion => ({ id, kind: "state", key, equals });
const before = (id: string, first: Match, second: Match): Assertion => ({
	id,
	kind: "before",
	first,
	second,
});
const steering = gap(
	"mid-turn-delivery",
	"One seeded input delivered between turns does not establish genuine mid-turn steering, cancellation or resumption.",
);
function probe(
	id: string,
	requirement: string,
	data: string,
	text: string,
	assertions: Assertion[],
): Probe {
	return {
		schema: 1,
		id: `continuity/${id}`,
		version: "1",
		aspect: "continuity",
		requirement: {
			id: requirement,
			text: requirement,
			source:
				".agents/skills/arbor/SKILL.md#Directives; references/checkpoint.md; Reporting",
		},
		seed: { id: seed.id, version: seed.version, data },
		input: {
			kind: id === "removed-report" ? "message" : "directive",
			origin: "user",
			text,
		},
		tools: ["arbor", "git", "read", "write"],
		evidence: ["events", "state", "reply"],
		assertions,
		stop: { kind: "reply" },
		bounds: { milliseconds: 30000, turns: 1, tokens: 2000 },
		execution: { kind: "agent", skill: "arbor" },
	};
}
const context =
	"\n\nThis is a seeded between-turn continuation of task continuity. Locate its worktree with arbor path continuity; its ARBOR.md holds the saved task context. No merge is in progress.";
const probes: Probe[] = [
	probe(
		"checkpoint",
		"continuity-checkpoint",
		"checkpoint",
		CHECKPOINT + context,
		[
			count("save-plan", write("ARBOR.md")),
			count("no-new-output", write("result.txt"), 0, 0),
			state("output-untouched", "file/result.txt", null),
			state("notes-updated", "plan/changed", true),
			state("sections-retained", "plan/sections", true),
			gap(
				"checkpoint-meaning",
				"Section presence and changed notes do not prove accurate Done/Next, preserved open questions, one-line reply or no other new work; arbitrary mutations require broader capture.",
			),
			steering,
		],
	),
	probe("resume", "continuity-checkpoint", "resume", RESUME + context, [
		before("read-before-continuing", read("ARBOR.md"), write("result.txt")),
		state("continued-saved-step", "file/result.txt", "ready\n"),
		steering,
	]),
	...(["completed", "partial", "failed"] as const).map((outcome) =>
		probe(
			`reconnect-${outcome}`,
			"continuity-reconnect",
			outcome,
			`${RECONNECT + context} The lost operation was writing result.txt with ready and a newline; its completion is unknown. Inspect git status, git log and the file before deciding whether to repeat it. Stop after recovering that step.`,
			[
				count("inspect-status", {
					actor: "agent",
					kind: "command",
					name: "git",
					args: ["status", "--porcelain"],
					exitCode: 0,
				}),
				count("inspect-history", {
					actor: "agent",
					kind: "command",
					name: "git",
					args: ["log", "-1", "--oneline"],
					exitCode: 0,
				}),
				count("inspect-outcome", read("result.txt")),
				...(outcome === "completed"
					? [count("do-not-repeat-completed-write", write("result.txt"), 0, 0)]
					: [
							before(
								"outcome-before-retry",
								read("result.txt"),
								write("result.txt"),
							),
							before(
								"status-before-retry",
								{
									actor: "agent",
									kind: "command",
									name: "git",
									args: ["status", "--porcelain"],
									exitCode: 0,
								},
								write("result.txt"),
							),
							before(
								"history-before-retry",
								{
									actor: "agent",
									kind: "command",
									name: "git",
									args: ["log", "-1", "--oneline"],
									exitCode: 0,
								},
								write("result.txt"),
							),
						]),
				state("recovered-output", "file/result.txt", "ready\n"),
				gap(
					"argv-variants",
					"Exact canonical git argv only; equivalent status/log options are not normalized. Failed seed means absent output, not a captured failed process.",
				),
				steering,
			],
		),
	),
	probe("update", "continuity-update", "update", CHECK_IN + context, [
		count("save-plan", write("ARBOR.md")),
		state("notes-updated", "plan/changed", true),
		state("meaningful-continuation", "file/result.txt", "ready\n"),
		gap(
			"intermediate-reply-order",
			"UPDATE requires ARBOR.md update -> user-visible intermediate reply before ANY next tool -> meaningful continuation. Schema-1 events cannot represent that reply; final reply or reply-before-code is not evidence.",
		),
		steering,
	]),
	probe(
		"removed-report",
		"continuity-report",
		"removed",
		"The seeded continuity task was removed as moot by the fixture. Report that outcome under the arbor reporting rules; no further action is needed and there are no open todos.",
		[
			{
				id: "task-format",
				kind: "reply",
				type: "report",
				field: ["report", "task"],
				equals: task,
			},
			{
				id: "outcome-format",
				kind: "reply",
				type: "report",
				field: ["report", "ending"],
				equals: "removed",
			},
			state("observed-task-plan-absent", "file/ARBOR.md", null),
			gap(
				"report-coherence",
				"Existential parsed fields can belong to separate reports. Absence of the observed plan supports only fixture removal; it does not prove an agent removed the task, prose quality, questions/choices or next-todo relevance.",
			),
		],
	),
];
export default { probes, seeds: [seed] } satisfies ProbeModule;
