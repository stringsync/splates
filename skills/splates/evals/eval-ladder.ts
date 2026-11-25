import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Check, Repo } from "@evals/evals/scenario";
import { type PermissionProposal, stretches } from "@splates/server/plans";
import {
	firstStep,
	mergeCmd,
	noFailedSplatesCommands,
	noUnrelatedReferences,
	opens,
	reported,
	taskWorktrees,
	withinToolCalls,
} from "./checks";
import { splatesSandbox } from "./sandbox";
import { describe, it, type Scenario } from "./scenario";

const aspect = "eval-ladder";

const SPEC_CHOSEN = "demo skill asks with a chosen pick";
const SPEC_SMALL = "demo skill notes small picks in SPLATES.md";

type SpecId = "chosen" | "small";

export const scenarios: Scenario[] = describe("splates skill", [
	describe("eval ladder scouting", [
		it(
			"starts a several-spec loop on one failing spec and the cheapest failing agent",
			{
				key: `${aspect}/scout-first`,
				initialized: true,
				detail:
					"When starting the first round of a several-spec eval loop after the budget is approved, read `references/evals.md`, inspect the saved eval agents (`splates evals agents`) and their costs (`splates agents`), and post a `run-evals` permission card targeting only one failing spec on the cheapest failing saved agent (`claude:haiku`) alone, rather than every spec or every agent.",
				message:
					"[SPLATES TASK asking-loop]\n\n[SPLATES EVAL BUDGET APPROVED]\nAdded $10: $10.00 of $10.00 left.",
				environment:
					"An initialized splates repo with open task `asking-loop` targeting two failing specs, three saved eval agents (`claude:haiku` low cost, `codex:gpt-5` medium cost, `claude:opus` high cost) all failing both specs, and `$10.00` approved budget.",
				example: [
					{
						kind: "tool",
						name: "Read",
						input: "references/evals.md",
						does: "Reads `evals.md` for the scout-first ladder and run card format.",
					},
					{
						kind: "tool",
						name: "Bash",
						input: "splates claim asking-loop",
						does: "Claims the open `asking-loop` task worktree.",
					},
					{
						kind: "tool",
						name: "Bash",
						input: "splates evals agents",
						does: "Checks the saved eval agents.",
					},
					{
						kind: "tool",
						name: "Bash",
						input: "splates agents",
						does: "Checks the COST column to pick the cheapest failing saved agent as the scout.",
					},
					{
						kind: "text",
						text: [
							"## 🔐 Permission: run evals demo: scout first asking spec",
							"",
							"Starts the ladder with one failing spec on the cheapest failing agent.",
							"",
							"Specs:",
							`- \`${SPEC_CHOSEN}\``,
							"",
							"Agents: `claude:haiku`",
						].join("\n"),
					},
				],
				seed: seedRepo,
				change: (repo) => setupLoopTask(repo, SPLATES_SCOUT_FIRST),
				expect: [
					readReference("evals.md"),
					{
						id: "single-failing-spec",
						about:
							"Reply holds a `run-evals` permission card targeting exactly one failing spec, not both.",
						test: ({ reply }) => {
							const card = runEvalsCardOf(reply);
							return card !== null && targetedSpecsOf(card).size === 1;
						},
					},
					{
						id: "cheapest-failing-agent-only",
						about:
							"The card's `Agents:` line names only the cheapest failing saved agent (`claude:haiku`), not `codex:gpt-5` or `claude:opus`.",
						test: ({ reply }) => {
							const card = runEvalsCardOf(reply);
							return hasExactAgents(card, ["claude:haiku"]);
						},
					},
					noDirectEval(),
					noFailedSplatesCommands(),
					withinToolCalls(14),
					noUnrelatedReferences(["evals.md", "waiting.md"]),
				],
				judge:
					"Does the reply end on a run-evals card for one failing spec on the cheapest failing agent alone rather than running every spec or every agent? Answer yes or no.",
				judgeWith: "claude:sonnet",
				limits: { turns: 14, minutes: 5 },
			},
		),
		it(
			"rechecks earlier passing specs on the scout before widening when a later spec's fix changed the skill",
			{
				key: `${aspect}/scout-recheck-after-edit`,
				initialized: true,
				detail:
					"When the scout (`claude:haiku`) just passed the second spec after a skill edit that happened after the first spec passed, read `references/evals.md` and post a `run-evals` permission card rechecking only the earlier passing spec (`demo skill asks with a chosen pick`) on the scout (`claude:haiku`) alone before widening to other agents, rather than rerunning the spec that just passed or widening yet.",
				message: [
					"[SPLATES TASK asking-loop]",
					"",
					"[SPLATES EVALS DONE batch-scout2]",
					"Budget: $1.20 spent, $8.80 of $10.00 left.",
					`- \`${SPEC_SMALL}\` on \`claude:haiku\`: 1/1 pass (current), 0/1 (main)`,
					"",
					"Coverage:",
					`- \`${SPEC_CHOSEN}\`: \`claude:haiku\` passed (1 run ago, before round 2's skill edit), \`codex:gpt-5\` failing, \`claude:opus\` failing`,
					`- \`${SPEC_SMALL}\`: \`claude:haiku\` passed (0 runs ago), \`codex:gpt-5\` failing, \`claude:opus\` failing`,
					"Agents: `codex:gpt-5`, `claude:opus`",
				].join("\n"),
				environment:
					"An initialized splates repo with open task `asking-loop` whose round 1 passed `demo skill asks with a chosen pick` on `claude:haiku` and round 2 edited the skill so `demo skill notes small picks in SPLATES.md` now passes on `claude:haiku`.",
				example: [
					{
						kind: "tool",
						name: "Read",
						input: "references/evals.md",
						does: "Reads `evals.md` for the scout recheck before widening.",
					},
					{
						kind: "tool",
						name: "Bash",
						input: "splates claim asking-loop",
						does: "Claims the open `asking-loop` task worktree.",
					},
					{
						kind: "text",
						text: [
							"Round 2 edited the skill after the first spec passed, so rechecking the first spec on `claude:haiku` before widening.",
							"",
							"## 🔐 Permission: run evals demo: recheck first asking spec on scout",
							"",
							"Confirms round 2's skill edit did not regress the earlier passing spec on the scout.",
							"",
							"Specs:",
							`- \`${SPEC_CHOSEN}\``,
							"",
							"Baseline: `main`",
							"Agents: `claude:haiku`",
						].join("\n"),
					},
				],
				seed: seedRepo,
				change: (repo) =>
					setupLoopTask(repo, SPLATES_SCOUT_RECHECK, SKILL_AFTER_ROUND2),
				expect: [
					readReference("evals.md"),
					{
						id: "earlier-spec-only",
						about:
							"Reply holds a `run-evals` permission card targeting only the earlier passing spec (`demo skill asks with a chosen pick`), not the spec that just passed.",
						test: ({ reply }) => {
							const card = runEvalsCardOf(reply);
							return hasExactSpecs(card, ["chosen"]);
						},
					},
					{
						id: "scout-agent-only",
						about:
							"The card's `Agents:` line names only the scout (`claude:haiku`), not `codex:gpt-5` or `claude:opus`.",
						test: ({ reply }) => {
							const card = runEvalsCardOf(reply);
							return hasExactAgents(card, ["claude:haiku"]);
						},
					},
					noDirectEval(),
					noFailedSplatesCommands(),
					withinToolCalls(14),
					noUnrelatedReferences(["evals.md", "waiting.md"]),
				],
				judge:
					"Does the reply recheck only the earlier passing spec on the scout before widening, rather than rerunning the spec that just passed or widening to other agents yet? Answer yes or no.",
				judgeWith: "claude:sonnet",
				limits: { turns: 14, minutes: 5 },
			},
		),
	]),
	describe("eval ladder widening", [
		it(
			"widens to every spec on the other agents once the scout passes every spec on the current skill",
			{
				key: `${aspect}/widen-after-scout`,
				initialized: true,
				detail:
					"When the scout (`claude:haiku`) has passed every targeted spec on the current skill with no new skill edits since earlier specs passed, read `references/evals.md` and post a `run-evals` permission card targeting both specs on the remaining agents from the coverage line (`codex:gpt-5` and `claude:opus`), leaving out `claude:haiku`.",
				message: [
					"[SPLATES TASK asking-loop]",
					"",
					"[SPLATES EVALS DONE batch-scout2]",
					"Budget: $1.20 spent, $8.80 of $10.00 left.",
					`- \`${SPEC_SMALL}\` on \`claude:haiku\`: 1/1 pass (current), 0/1 (main)`,
					"",
					"Coverage:",
					`- \`${SPEC_CHOSEN}\`: \`claude:haiku\` passed (1 run ago), \`codex:gpt-5\` failing, \`claude:opus\` failing`,
					`- \`${SPEC_SMALL}\`: \`claude:haiku\` passed (0 runs ago), \`codex:gpt-5\` failing, \`claude:opus\` failing`,
					"Agents: `codex:gpt-5`, `claude:opus`",
				].join("\n"),
				environment:
					"An initialized splates repo with open task `asking-loop` branched from `main` with a committed skill fix from round 1, where round 2 passed the second spec on `claude:haiku` without any new skill edit and `codex:gpt-5` and `claude:opus` still fail both specs.",
				example: [
					{
						kind: "tool",
						name: "Read",
						input: "references/evals.md",
						does: "Reads `evals.md` for the widen rung of the ladder.",
					},
					{
						kind: "tool",
						name: "Bash",
						input: "splates claim asking-loop",
						does: "Claims the open `asking-loop` task worktree.",
					},
					{
						kind: "text",
						text: [
							"The scout passes both specs on the current skill with no new edits, so widening to the remaining agents.",
							"",
							"## 🔐 Permission: run evals demo: widen asking specs",
							"",
							"Widens every asking spec to the other saved agents now that the scout passes all of them.",
							"",
							"Specs:",
							`- \`${SPEC_CHOSEN}\``,
							`- \`${SPEC_SMALL}\``,
							"",
							"Baseline: `main`",
							"Agents: `codex:gpt-5`, `claude:opus`",
							"Left out: `claude:haiku` (round 2)",
						].join("\n"),
					},
				],
				seed: seedRepo,
				change: (repo) =>
					setupLoopTask(repo, SPLATES_WIDEN_AFTER_SCOUT, SKILL_AFTER_ROUND1),
				expect: [
					readReference("evals.md"),
					{
						id: "both-specs-targeted",
						about:
							"Reply holds a `run-evals` permission card targeting both specs, not just one.",
						test: ({ reply }) => {
							const card = runEvalsCardOf(reply);
							return hasExactSpecs(card, ["chosen", "small"]);
						},
					},
					{
						id: "other-agents-only",
						about:
							"The card's `Agents:` line names both `codex:gpt-5` and `claude:opus` and leaves out `claude:haiku`.",
						test: ({ reply }) => {
							const card = runEvalsCardOf(reply);
							return hasExactAgents(card, ["codex:gpt-5", "claude:opus"]);
						},
					},
					noDirectEval(),
					noFailedSplatesCommands(),
					withinToolCalls(14),
					noUnrelatedReferences(["evals.md", "waiting.md"]),
				],
				judge:
					"Does the reply widen to every targeted spec on the other agents from the coverage line (`codex:gpt-5` and `claude:opus`) while leaving out the scout that already passed? Answer yes or no.",
				judgeWith: "claude:sonnet",
				limits: { turns: 14, minutes: 5 },
			},
		),
		it(
			"narrows to the breaking agent and its failing spec when widening breaks one agent",
			{
				key: `${aspect}/narrow-after-widen`,
				initialized: true,
				detail:
					"When a widen round passes `claude:opus` on both specs and `codex:gpt-5` on the first spec, while `codex:gpt-5` fails only `demo skill notes small picks in SPLATES.md`, read `references/evals.md`, address the skill issue if needed, and post a `run-evals` permission card narrowed to `codex:gpt-5` and its failing spec alone rather than rerunning passing specs or passing agents.",
				message: [
					"[SPLATES TASK asking-loop]",
					"",
					"[SPLATES EVALS DONE batch-widen1]",
					"Budget: $3.10 spent, $6.90 of $10.00 left.",
					`- \`${SPEC_CHOSEN}\` on \`codex:gpt-5\`: 1/1 pass (current), 0/1 (main)`,
					`- \`${SPEC_CHOSEN}\` on \`claude:opus\`: 1/1 pass (current), 0/1 (main)`,
					`- \`${SPEC_SMALL}\` on \`codex:gpt-5\`: 0/1 fail (current), 0/1 (main): failed check \`noted-alternative\` ("Picked a default timeout without noting its alternative in SPLATES.md.")`,
					`- \`${SPEC_SMALL}\` on \`claude:opus\`: 1/1 pass (current), 0/1 (main)`,
					"",
					"Coverage:",
					`- \`${SPEC_CHOSEN}\`: \`claude:haiku\` passed (2 runs ago), \`codex:gpt-5\` passed (0 runs ago), \`claude:opus\` passed (0 runs ago)`,
					`- \`${SPEC_SMALL}\`: \`claude:haiku\` passed (1 run ago), \`codex:gpt-5\` failing, \`claude:opus\` passed (0 runs ago)`,
					"Agents: `codex:gpt-5`",
				].join("\n"),
				environment:
					"An initialized splates repo with open task `asking-loop` after a widen round where `claude:opus` passed both specs, `codex:gpt-5` passed the first spec, and only `codex:gpt-5` failed the second spec.",
				example: [
					{
						kind: "tool",
						name: "Read",
						input: "references/evals.md",
						does: "Reads `evals.md` for narrowing again when widening breaks one agent.",
					},
					{
						kind: "tool",
						name: "Bash",
						input: "splates claim asking-loop",
						does: "Claims the open `asking-loop` task worktree.",
					},
					{
						kind: "text",
						text: [
							"Tightened the small-pick alternative rule in the skill for `codex:gpt-5` and rerunning only that agent on its failing spec.",
							"",
							"## 🔐 Permission: run evals demo: narrow to codex small picks",
							"",
							"Narrows to `codex:gpt-5` on its failing spec before rechecking the scout.",
							"",
							"Specs:",
							`- \`${SPEC_SMALL}\``,
							"",
							"Baseline: `main`",
							"Agents: `codex:gpt-5`",
						].join("\n"),
					},
				],
				seed: seedRepo,
				change: (repo) =>
					setupLoopTask(repo, SPLATES_NARROW_AFTER_WIDEN, SKILL_AFTER_ROUND1),
				expect: [
					readReference("evals.md"),
					{
						id: "failing-spec-only",
						about:
							"Reply holds a `run-evals` permission card targeting only the failing spec (`demo skill notes small picks in SPLATES.md`), not the passing spec.",
						test: ({ reply }) => {
							const card = runEvalsCardOf(reply);
							return hasExactSpecs(card, ["small"]);
						},
					},
					{
						id: "breaking-agent-only",
						about:
							"The card's `Agents:` line names only `codex:gpt-5`, not `claude:haiku` or `claude:opus`.",
						test: ({ reply }) => {
							const card = runEvalsCardOf(reply);
							return hasExactAgents(card, ["codex:gpt-5"]);
						},
					},
					noDirectEval(),
					noFailedSplatesCommands(),
					withinToolCalls(18),
					noUnrelatedReferences(["evals.md", "waiting.md"]),
				],
				judge:
					"Does the reply narrow the next round to `codex:gpt-5` and its failing spec alone rather than rerunning passing specs or passing agents? Answer yes or no.",
				judgeWith: "claude:sonnet",
				limits: { turns: 18, minutes: 6 },
			},
		),
		it(
			"runs one confirm round of every spec on every saved agent with no Left out when expecting everything to pass",
			{
				key: `${aspect}/confirm-full-grid`,
				initialized: true,
				detail:
					"When every targeted spec has passed on every saved agent across the narrow, widen, and scout-recheck rounds, but no full-grid confirm round has run yet, read `references/evals.md` and post one confirm `run-evals` permission card targeting both specs on all three saved agents (`claude:haiku`, `codex:gpt-5`, `claude:opus`) with no `Left out:` line, without merging or ending the loop early.",
				message: [
					"[SPLATES TASK asking-loop]",
					"",
					"[SPLATES EVALS DONE batch-recheck1]",
					"Budget: $4.20 spent, $5.80 of $10.00 left.",
					`- \`${SPEC_SMALL}\` on \`claude:haiku\`: 1/1 pass (current), 0/1 (main)`,
					"",
					"Coverage:",
					`- \`${SPEC_CHOSEN}\`: \`claude:haiku\` passed (2 runs ago), \`codex:gpt-5\` passed (1 run ago), \`claude:opus\` passed (1 run ago)`,
					`- \`${SPEC_SMALL}\`: \`claude:haiku\` passed (0 runs ago), \`codex:gpt-5\` passed (1 run ago), \`claude:opus\` passed (1 run ago)`,
					"Agents: `claude:haiku`, `codex:gpt-5`, `claude:opus`",
				].join("\n"),
				environment:
					"An initialized splates repo with open task `asking-loop` whose `SPLATES.md` records scout, widen, narrow, and scout-recheck rounds where every spec has passed on every saved agent, with no full-grid confirm round yet.",
				example: [
					{
						kind: "tool",
						name: "Read",
						input: "references/evals.md",
						does: "Reads `evals.md` for the confirm rung before stopping the loop.",
					},
					{
						kind: "tool",
						name: "Bash",
						input: "splates claim asking-loop",
						does: "Claims the open `asking-loop` task worktree.",
					},
					{
						kind: "text",
						text: [
							"Every spec now passes on each saved agent after the narrow fix and scout recheck, so running one full-grid confirm round.",
							"",
							"## 🔐 Permission: run evals demo: confirm all asking specs",
							"",
							"Confirms every asking spec on every saved agent before stopping the loop.",
							"",
							"Specs:",
							`- \`${SPEC_CHOSEN}\``,
							`- \`${SPEC_SMALL}\``,
							"",
							"Baseline: `main`",
							"Agents: `claude:haiku`, `codex:gpt-5`, `claude:opus`",
						].join("\n"),
					},
				],
				seed: seedRepo,
				change: (repo) =>
					setupLoopTask(repo, SPLATES_CONFIRM_GRID, SKILL_AFTER_CODEX_FIX),
				expect: [
					readReference("evals.md"),
					{
						id: "confirm-all-specs-and-agents",
						about:
							"Reply holds a `run-evals` permission card targeting both specs on all three saved agents (`claude:haiku`, `codex:gpt-5`, `claude:opus`).",
						test: ({ reply }) => {
							const card = runEvalsCardOf(reply);
							return (
								hasExactSpecs(card, ["chosen", "small"]) &&
								hasExactAgents(card, [
									"claude:haiku",
									"codex:gpt-5",
									"claude:opus",
								])
							);
						},
					},
					{
						id: "no-left-out-line",
						about: "The confirm run card has no `Left out:` line.",
						test: ({ reply }) => {
							const card = runEvalsCardOf(reply);
							return (
								card !== null &&
								(card.evals?.leftOut?.length ?? 0) === 0 &&
								!/^Left out:/im.test(card.body)
							);
						},
					},
					{
						id: "did-not-stop-before-confirm",
						about:
							"Did not merge or report the loop done before the confirm round ran.",
						test: ({ reply, commands }) =>
							!commands.some(mergeCmd) &&
							!reported(reply, "merged") &&
							!reported(reply, "done"),
					},
					noDirectEval(),
					noFailedSplatesCommands(),
					withinToolCalls(14),
					noUnrelatedReferences(["evals.md", "waiting.md"]),
				],
				judge:
					"Does the reply post a single confirm run card for every targeted spec on every saved agent with no `Left out:` line instead of stopping early or omitting an agent? Answer yes or no.",
				judgeWith: "claude:sonnet",
				limits: { turns: 14, minutes: 5 },
			},
		),
	]),
]);

export const sandbox = splatesSandbox(scenarios);

function readReference(name: string): Check {
	return {
		id: `read-${name.replace(/\.md$/, "")}`,
		about: `Opened \`references/${name}\`.`,
		test: ({ transcript }) =>
			firstStep(transcript, opens(`references/${name}`)) !== -1,
	};
}

function noDirectEval(): Check {
	return {
		id: "no-direct-eval-command",
		about: "Ran no eval command directly.",
		test: ({ commands }) => !ranDirectEval(commands),
	};
}

function runEvalsCardOf(reply: string): PermissionProposal | null {
	for (const part of stretches(reply)) {
		if (part.type === "permission" && part.permission.action === "run-evals") {
			return part.permission;
		}
	}
	return null;
}

function hasExactAgents(
	card: PermissionProposal | null,
	expected: readonly string[],
): boolean {
	const actual = card?.evals?.agents;
	if (!actual || actual.length === 0) {
		return false;
	}
	const seen = new Set(actual);
	return (
		seen.size === expected.length && expected.every((agent) => seen.has(agent))
	);
}

function hasExactSpecs(
	card: PermissionProposal | null,
	expected: readonly SpecId[],
): boolean {
	if (card === null) {
		return false;
	}
	const targeted = targetedSpecsOf(card);
	return (
		targeted.size === expected.length &&
		expected.every((spec) => targeted.has(spec))
	);
}

/** Resolves which of the two seeded `asking` specs a `run-evals` card targets. */
function targetedSpecsOf(card: PermissionProposal): Set<SpecId> {
	const found = new Set<SpecId>();
	const matchSpecLine = (line: string) => {
		const lower = line.toLowerCase();
		if (
			lower.includes(SPEC_CHOSEN.toLowerCase()) ||
			lower.includes("asking/chosen-pick") ||
			lower.includes("chosen pick")
		) {
			found.add("chosen");
		}
		if (
			lower.includes(SPEC_SMALL.toLowerCase()) ||
			lower.includes("asking/small-picks") ||
			lower.includes("small picks")
		) {
			found.add("small");
		}
	};

	for (const id of card.evals?.scenarios ?? []) {
		matchSpecLine(id);
	}

	const lines = card.body.split("\n");
	const bulletLines = lines.filter((line) => /^\s*[-*]\s+/.test(line));
	for (const line of bulletLines) {
		matchSpecLine(line);
	}

	const specsLines = lines.filter((line) => /^Specs:/i.test(line.trim()));
	for (const raw of specsLines) {
		const value = raw.replace(/^Specs:\s*/i, "").trim();
		if (value === "") {
			continue;
		}
		// Explicit bullet items narrow a `Specs: match ...` or `Specs: group ...` header.
		if (found.size > 0) {
			continue;
		}
		if (/^group\s+asking\b/i.test(value)) {
			found.add("chosen");
			found.add("small");
			continue;
		}
		const matchArg = /^match\s+(.+)$/i.exec(value)?.[1]?.trim();
		if (matchArg) {
			const clean = matchArg.replace(/^["'`]|["'`]$/g, "").toLowerCase();
			if (SPEC_CHOSEN.toLowerCase().includes(clean)) {
				found.add("chosen");
			}
			if (SPEC_SMALL.toLowerCase().includes(clean)) {
				found.add("small");
			}
			continue;
		}
		matchSpecLine(value);
	}

	return found;
}

function ranDirectEval(commands: string[]): boolean {
	return commands.some(
		(cmd) =>
			/\b(?:bin\/)?evals\s+run\b/.test(cmd) ||
			(/\bsplates["']?\s+dev\s+eval\b/.test(cmd) &&
				!/\bsplates["']?\s+dev\s+eval\s+(?:list|show|report|check|agents)\b/.test(
					cmd,
				)),
	);
}

async function seedRepo(repo: Repo): Promise<void> {
	await repo.write("package.json", PACKAGE);
	await repo.write("splates.config.ts", EVAL_CONFIG);
	await repo.write("skills/demo/SKILL.md", SKILL_INITIAL);
	await repo.write("skills/demo/evals/asking.ts", SEEDED_EVAL_FILE);
}

async function setupLoopTask(
	repo: Repo,
	splatesMd: string,
	skillUpdate?: string,
): Promise<void> {
	const home = join(repo.dir, "..", "splates-home");
	await mkdir(home, { recursive: true });
	await writeFile(
		join(home, "agents.json"),
		`${JSON.stringify(ROSTER, null, "\t")}\n`,
	);
	await writeFile(
		join(home, "eval-agents.json"),
		`${JSON.stringify(EVAL_AGENTS, null, "\t")}\n`,
	);

	await repo.run([
		"splates",
		"add",
		"asking-loop",
		"--goal",
		"Get both asking evals passing on every saved eval agent",
	]);
	const worktree = (await taskWorktrees(repo))[0];
	if (!worktree) {
		throw new Error("asking-loop worktree not created");
	}
	if (skillUpdate !== undefined) {
		await writeFile(join(worktree, "skills/demo/SKILL.md"), skillUpdate);
		await repo.run(["git", "-C", worktree, "add", "skills/demo/SKILL.md"]);
		await repo.run([
			"git",
			"-C",
			worktree,
			"commit",
			"-qm",
			"Clarify asking rules in demo skill",
		]);
	}
	await writeFile(join(worktree, "SPLATES.md"), splatesMd);
}

const ROSTER = {
	format: 1,
	agents: [
		{
			id: "claude",
			name: "Claude",
			argv: ["false"],
			models: [
				model("haiku", "Haiku", "quick edits", "low", 1, "fast"),
				model("opus", "Opus", "complex work", "high", 3, "medium"),
			],
		},
		{
			id: "codex",
			name: "Codex",
			argv: ["false"],
			models: [
				model("gpt-5", "GPT-5", "everyday coding", "medium", 2, "medium"),
			],
		},
	],
};

function model(
	id: string,
	name: string,
	strengths: string,
	cost: string,
	tier: number,
	speed: string,
) {
	return { id, name, strengths, cost, tier, speed, costRank: tier };
}

const EVAL_AGENTS = {
	format: 1,
	agents: [
		{ agent: "claude", model: "haiku" },
		{ agent: "codex", model: "gpt-5" },
		{ agent: "claude", model: "opus" },
	],
};

const PACKAGE = '{\n\t"name": "demo-skill",\n\t"type": "module"\n}\n';
const EVAL_CONFIG =
	'export default {\n\tpreMerge: "true",\n\tevals: { list: "echo \'asking\'", run: "true" },\n};\n';
const SKILL_INITIAL =
	"# Demo skill\n\nAsk open decisions in a numbered questions card.\n";
const SKILL_AFTER_ROUND1 = `${SKILL_INITIAL}Mark a \`(chosen)\` default pick on every question, and note cheap local picks in \`SPLATES.md\`.\n`;
const SKILL_AFTER_ROUND2 = `${SKILL_INITIAL}Mark a \`(chosen)\` default pick on every question, and note both each cheap local pick and its alternative in \`SPLATES.md\`.\n`;
const SKILL_AFTER_CODEX_FIX = `${SKILL_AFTER_ROUND2}For example: \`- retry limit 3; 5 is the alternative\`.\n`;

const SEEDED_EVAL_FILE = `export const scenarios = [
	{ id: "asking/chosen-pick", aspect: "asking", title: "${SPEC_CHOSEN}" },
	{ id: "asking/small-picks", aspect: "asking", title: "${SPEC_SMALL}" },
];
`;

function loopSplatesMd(details: string, rounds?: readonly string[]): string {
	const header = [
		"# asking-loop",
		"",
		"## Before",
		"",
		"Both `asking` specs fail on all three saved eval agents (`claude:haiku`, `codex:gpt-5`, `claude:opus`).",
		"",
		"## After",
		"",
		"Both `asking` specs pass on every saved eval agent.",
		"",
		"## Details",
		"",
		details,
	];
	if (!rounds || rounds.length === 0) {
		return `${header.join("\n")}\n`;
	}
	return `${[
		...header,
		"",
		"## Rounds",
		"",
		"| Round | Label | Change | Current | Baseline |",
		"| ----- | ----- | ------ | ------- | -------- |",
		...rounds,
	].join("\n")}\n`;
}

const SPLATES_SCOUT_FIRST = loopSplatesMd(
	[
		"Started from `[SPLATES EVAL LOOP scenarios asking/chosen-pick asking/small-picks]`:",
		`- \`${SPEC_CHOSEN}\` (failing on \`claude:haiku\`, \`codex:gpt-5\`, \`claude:opus\`)`,
		`- \`${SPEC_SMALL}\` (failing on \`claude:haiku\`, \`codex:gpt-5\`, \`claude:opus\`)`,
		"",
		"An eval budget card was posted for the first round and waits on the user's answer.",
	].join("\n"),
);

const SPLATES_SCOUT_RECHECK = loopSplatesMd(
	`Targeting both specs in \`asking\`: \`${SPEC_CHOSEN}\` and \`${SPEC_SMALL}\`.`,
	[
		`| 1 | skill | Added \`(chosen)\` default pick rule for \`${SPEC_CHOSEN}\` on \`claude:haiku\` | 1/1 | 0/1 |`,
		`| 2 | skill | Edited \`skills/demo/SKILL.md\` to require noting the alternative for \`${SPEC_SMALL}\` on \`claude:haiku\` | 1/1 | 0/1 |`,
	],
);

const SPLATES_WIDEN_AFTER_SCOUT = loopSplatesMd(
	`Targeting both specs in \`asking\`: \`${SPEC_CHOSEN}\` and \`${SPEC_SMALL}\`. Round 1's skill edit fixed \`${SPEC_CHOSEN}\` on \`claude:haiku\`, and round 2 ran \`${SPEC_SMALL}\` on \`claude:haiku\` with no new skill edit and passed.`,
	[
		`| 1 | skill | Clarified asking and small-pick rules for \`${SPEC_CHOSEN}\` on \`claude:haiku\` | 1/1 | 0/1 |`,
		`| 2 | scout | Ran \`${SPEC_SMALL}\` on \`claude:haiku\` with no new skill edit | 1/1 | 0/1 |`,
	],
);

const SPLATES_NARROW_AFTER_WIDEN = loopSplatesMd(
	`Targeting both specs in \`asking\`: \`${SPEC_CHOSEN}\` and \`${SPEC_SMALL}\`. Scout \`claude:haiku\` passed both specs; round 3 widened both specs to \`codex:gpt-5\` and \`claude:opus\`.`,
	[
		"| 1 | skill | Clarified asking and small-pick rules on `claude:haiku` | 1/1 | 0/1 |",
		"| 2 | scout | Verified second spec on `claude:haiku` | 1/1 | 0/1 |",
	],
);

const SPLATES_CONFIRM_GRID = loopSplatesMd(
	`Targeting both specs in \`asking\`: \`${SPEC_CHOSEN}\` and \`${SPEC_SMALL}\`. No full-grid confirm round has run yet.`,
	[
		`| 1 | skill | Clarified asking rules on \`claude:haiku\` (\`${SPEC_CHOSEN}\`) | 1/1 | 0/1 |`,
		`| 2 | scout | Passed \`${SPEC_SMALL}\` on \`claude:haiku\` | 1/1 | 0/1 |`,
		`| 3 | widen | Passed \`claude:opus\` (2/2) and \`codex:gpt-5\` (\`${SPEC_CHOSEN}\`); \`codex:gpt-5\` failed \`${SPEC_SMALL}\` | 3/4 | 0/4 |`,
		`| 4 | skill | Added explicit alternative example; \`codex:gpt-5\` passed \`${SPEC_SMALL}\` | 1/1 | 0/1 |`,
		`| 5 | scout-recheck | Rechecked \`${SPEC_SMALL}\` on \`claude:haiku\` after round 4's edit | 1/1 | 0/1 |`,
	],
);
