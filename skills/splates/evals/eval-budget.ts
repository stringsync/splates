import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Check } from "@evals/evals/scenario";
import { type PermissionProposal, stretches } from "@splates/server/plans";
import {
	firstStep,
	mergeCmd,
	noFailedSplatesCommands,
	noUnrelatedReferences,
	opens,
	taskWorktrees,
	withinToolCalls,
} from "./checks";
import { splatesSandbox } from "./sandbox";
import { describe, it, type Scenario } from "./scenario";

const aspect = "eval-budget";

export const scenarios: Scenario[] = describe("splates skill", [
	describe("eval budget", [
		it("asks for an eval budget card before posting the first run card", {
			key: `${aspect}/before-first-round`,
			initialized: true,
			detail:
				"When asked to check a skill change with evals in a conversation with no approved eval budget, read `references/evals.md`, post an eval budget permission card (`## 🔐 Permission: eval budget: ...` with an `Asks: $<amount>` line and `Round: up to $<amount>` when known), and end the turn without posting a run-evals card, running evals directly, or asking in prose.",
			message:
				"The asking rules in the skill were tightened. Check the asking specs with evals on claude:sonnet (a round runs about $2).",
			environment:
				"An initialized splates repo with a skill change ready to evaluate and no approved eval budget in the conversation.",
			example: [
				{
					kind: "tool",
					name: "Read",
					input: "references/evals.md",
					does: "Reads `evals.md` for the eval budget card rules and format.",
				},
				{
					kind: "text",
					text: "## 🔐 Permission: eval budget: the asking specs\n\nChecks the tightened asking rules on `claude:sonnet`; expect about three rounds.\n\nAsks: $6\nRound: up to $2.00",
				},
			],
			seed: async (repo) => {
				await repo.write("package.json", PACKAGE);
				await repo.write("splates.config.ts", EVAL_CONFIG);
				await repo.write("skills/demo/SKILL.md", SKILL_MD);
			},
			expect: [
				readReference("evals.md"),
				{
					id: "eval-budget-card",
					about:
						"Reply holds an `eval-budget` permission card with a positive dollar `Asks:` line.",
					test: ({ reply }) => {
						const card = evalBudgetCardOf(reply);
						return (
							card?.budget?.usd !== undefined &&
							card.budget.usd !== null &&
							card.budget.usd > 0
						);
					},
				},
				{
					id: "no-run-card-or-direct-eval",
					about:
						"Reply holds no `run-evals` permission card and runs no eval command directly.",
					test: ({ reply, commands }) =>
						!hasRunEvalsCard(reply) && !ranDirectEval(commands),
				},
				noFailedSplatesCommands(),
				withinToolCalls(12),
				noUnrelatedReferences(["evals.md", "waiting.md"]),
			],
			judge:
				"Does the reply post an eval budget card naming what the rounds are for, with a dollar ask and round ceiling, and end its turn rather than posting a run card or asking in prose? Answer yes or no.",
			judgeWith: "claude:sonnet",
			limits: { turns: 12, minutes: 5 },
		}),
		it(
			"asks for at least the shortfall on a new eval budget card when a round is short",
			{
				key: `${aspect}/short-round`,
				initialized: true,
				detail:
					"When told that a run card waits for a budget because the round's ceiling ($3.20) exceeds what is left ($0.80 of $5.00), read `references/evals.md` and post a new eval budget permission card asking for at least the $2.40 shortfall (with `Round: up to $3.20`), ending the turn without reposting the run-evals card or waiting silently.",
				message:
					"Your run card for the asking specs waits for a budget: this round may cost up to $3.20, and this conversation has $0.80 left of the $5.00 eval budget approved for it.",
				environment:
					"An initialized splates repo whose conversation has $0.80 left of a $5.00 eval budget while the next round may cost up to $3.20.",
				example: [
					{
						kind: "tool",
						name: "Read",
						input: "references/evals.md",
						does: "Reads `evals.md` for how to ask for more budget when a round is short.",
					},
					{
						kind: "text",
						text: "## 🔐 Permission: eval budget: more for the asking specs\n\nThe next round may cost up to $3.20 with $0.80 left; asking for $5 more to cover this round and a follow-up.\n\nAsks: $5\nRound: up to $3.20",
					},
				],
				seed: async (repo) => {
					await repo.write("package.json", PACKAGE);
					await repo.write("splates.config.ts", EVAL_CONFIG);
					await repo.write("skills/demo/SKILL.md", SKILL_MD);
				},
				expect: [
					readReference("evals.md"),
					{
						id: "shortfall-budget-card",
						about:
							"Reply holds an `eval-budget` permission card whose `Asks:` amount is at least $2.40 and includes `Round: up to $3.20`.",
						test: ({ reply }) => {
							const card = evalBudgetCardOf(reply);
							const usd = card?.budget?.usd ?? null;
							const round = card?.budget?.round ?? null;
							return (
								usd !== null &&
								usd >= 2.4 &&
								round !== null &&
								Math.abs(round - 3.2) < 0.005
							);
						},
					},
					{
						id: "no-run-card-or-direct-eval",
						about:
							"Reply holds no `run-evals` permission card and runs no eval command directly.",
						test: ({ reply, commands }) =>
							!hasRunEvalsCard(reply) && !ranDirectEval(commands),
					},
					noFailedSplatesCommands(),
					withinToolCalls(10),
					noUnrelatedReferences(["evals.md", "waiting.md"]),
				],
				judge:
					"Does the reply post a new eval budget card asking for at least the $2.40 shortfall and end its turn without reposting the run card or waiting silently? Answer yes or no.",
				judgeWith: "claude:sonnet",
				limits: { turns: 10, minutes: 5 },
			},
		),
		it(
			"stops asking, asks how to proceed in a questions card, merges the eval, and sets a retry signal when a budget is declined",
			{
				key: `${aspect}/declined`,
				initialized: true,
				detail:
					"On `[SPLATES EVAL BUDGET DECLINED]` for an open task holding a committed eval scenario, read `references/evals.md`, post neither a `run-evals` card nor another `eval-budget` card, merge the task so the written eval lands on main, set a signal to retry when budget or quota returns, and ask how to proceed in a splates numbered questions card (`1. ...?`, `- (a)` choices with a `(chosen)` pick, no `I` or `you`) offering alternatives such as a smaller budget, quota reset, or improving the skill without evals.",
				message: "[SPLATES TASK asking-eval]\n\n[SPLATES EVAL BUDGET DECLINED]",
				environment:
					"An initialized splates repo with open task `asking-eval` containing a committed new eval scenario, after its eval budget card was declined.",
				example: [
					{
						kind: "tool",
						name: "Read",
						input: "references/evals.md",
						does: "Reads `evals.md` for how to handle a declined eval budget.",
					},
					{
						kind: "tool",
						name: "Bash",
						input: "splates claim asking-eval",
						does: "Claims the open `asking-eval` task worktree.",
					},
					{
						kind: "tool",
						name: "Bash",
						input: 'splates merge --message "Add asking eval scenario"',
						does: "Merges the written eval scenario onto `main` so it is kept for later.",
					},
					{
						kind: "tool",
						name: "Bash",
						input:
							'splates signal wait clock.at("tomorrow 9am") --timeout 2d --description "Model quota or eval budget is expected back, so the asking eval loop can retry."',
						does: "Sets a clock signal to retry the eval run once budget or quota returns.",
					},
					{
						kind: "text",
						text: "1. How should the asking eval loop proceed without a budget right now?\n   The new eval is merged onto main and a retry signal is set for tomorrow.\n   - (a) Improve the skill without running evals for now (chosen)\n   - (b) Retry with a smaller dollar budget\n   - (c) Wait for model quota to reset before running",
					},
				],
				seed: async (repo) => {
					await repo.write("package.json", PACKAGE);
					await repo.write("splates.config.ts", EVAL_CONFIG);
					await repo.write("skills/demo/SKILL.md", SKILL_MD);
				},
				change: async (repo) => {
					await repo.run([
						"splates",
						"add",
						"asking-eval",
						"--goal",
						"Add asking eval scenario",
					]);
					const worktree = (await taskWorktrees(repo))[0];
					if (!worktree) {
						throw new Error("asking-eval worktree not created");
					}
					const evalPath = join(worktree, "skills/demo/evals/asking.ts");
					await mkdir(join(worktree, "skills/demo/evals"), { recursive: true });
					await writeFile(evalPath, SEEDED_EVAL_FILE);
					await repo.run([
						"git",
						"-C",
						worktree,
						"add",
						"skills/demo/evals/asking.ts",
					]);
					await repo.run([
						"git",
						"-C",
						worktree,
						"commit",
						"-qm",
						"Add asking eval scenario",
					]);
					await writeFile(
						join(worktree, "SPLATES.md"),
						SEEDED_DECLINED_SPLATES,
					);
				},
				expect: [
					readReference("evals.md"),
					{
						id: "no-eval-cards-or-run",
						about:
							"Reply holds neither a `run-evals` nor an `eval-budget` permission card and runs no eval command.",
						test: ({ reply, commands }) =>
							!hasRunEvalsCard(reply) &&
							evalBudgetCardOf(reply) === null &&
							!ranDirectEval(commands),
					},
					{
						id: "questions-card-how-to-proceed",
						about:
							"Reply asks how to proceed in a splates numbered questions card (`1. ...?`, `- (a)` choices with a `(chosen)` pick, no `I` or `you`).",
						test: ({ reply }) => {
							const cards = stretches(reply).filter(
								(part) => part.type === "questions",
							);
							if (cards.length === 0) {
								return false;
							}
							return cards.some(
								(card) =>
									card.type === "questions" &&
									card.questions.length > 0 &&
									card.questions.every(
										(question) =>
											question.text.trim().endsWith("?") &&
											!/^do you approve\b/i.test(question.text) &&
											!hasForbiddenPronoun(question.text) &&
											question.choices.length >= 2 &&
											question.choices.filter((choice) => choice.chosen)
												.length >= 1 &&
											question.choices.every(
												(choice) => !hasForbiddenPronoun(choice.text),
											),
									),
							);
						},
					},
					{
						id: "merged-eval-to-main",
						about:
							"Merged `asking-eval` onto main instead of dropping or removing the eval.",
						live: true,
						test: async ({ repo, commands }) => {
							if (
								!commands.some(mergeCmd) ||
								commands.some((cmd) => /\bsplates["']?\s+remove\b/.test(cmd))
							) {
								return false;
							}
							try {
								const landed = await repo.run([
									"git",
									"show",
									"HEAD:skills/demo/evals/asking.ts",
								]);
								return landed.includes("asking/default-pick");
							} catch {
								return false;
							}
						},
					},
					{
						id: "set-retry-signal",
						about:
							"Ran a `splates signal` or `splates wait` command to retry when budget or quota returns.",
						test: ({ reply, commands }) =>
							commands.some((cmd) =>
								/\bsplates["']?\s+(?:signal|wait)\b/.test(cmd),
							) || /\[SPLATES WAIT\b/.test(reply),
					},
					noFailedSplatesCommands(),
					withinToolCalls(18),
					noUnrelatedReferences([
						"evals.md",
						"questions.md",
						"signals.md",
						"merge.md",
						"reporting.md",
						"waiting.md",
					]),
				],
				judge:
					"Does the reply stop asking for rounds, use a splates questions card offering alternatives (such as a smaller budget, quota reset, or improving the skill without evals), keep the merged eval, and set up a retry signal? Answer yes or no.",
				judgeWith: "claude:sonnet",
				limits: { turns: 18, minutes: 6 },
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

function evalBudgetCardOf(reply: string): PermissionProposal | null {
	for (const part of stretches(reply)) {
		if (
			part.type === "permission" &&
			part.permission.action === "eval-budget"
		) {
			return part.permission;
		}
	}
	return null;
}

function hasRunEvalsCard(reply: string): boolean {
	return stretches(reply).some(
		(part) =>
			part.type === "permission" && part.permission.action === "run-evals",
	);
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

function hasForbiddenPronoun(text: string): boolean {
	return (
		/\b(?:I|I'm|I'll|I'd|I've)\b/.test(text) ||
		/\b(?:you|your|you're|you'll)\b/i.test(text)
	);
}

const PACKAGE = '{\n\t"name": "demo-skill",\n\t"type": "module"\n}\n';

const EVAL_CONFIG = `export default {
	preMerge: "true",
	evals: {
		list: "echo 'asking'",
		run: "true",
	},
};
`;

const SKILL_MD = `# Demo skill

Ask open decisions in a numbered questions card with a \`(chosen)\` default pick.
`;

const SEEDED_EVAL_FILE = `export const scenarios = [
	{
		id: "asking/default-pick",
		aspect: "asking",
		requirement: "Marks a default pick on every preference question.",
		message: "Should we export CSV or JSON?",
		judge: "Did the reply mark one choice as chosen? Answer yes or no.",
	},
];
`;

const SEEDED_DECLINED_SPLATES = `# asking-eval

## Before

No eval checks that preference questions mark a default pick.

## After

An eval scenario covers default picks on preference questions, and its first run has been checked.

## Details

The eval scenario in \`skills/demo/evals/asking.ts\` is written and committed. An eval budget card was posted for the first round and waits on the user's answer.
`;
