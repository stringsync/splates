import type { Check, Outcome, Scenario } from "@evals/evals/scenario";
import { noRunCard, shared, unchanged } from "./eval-loop";
import { loopSandbox, originals, savedLoop } from "./loop-fixture";
import {
	subject,
	type Transition,
	TransitionFixture,
	task,
	transitions,
} from "./loop-transition-fixture";

export const sandbox = loopSandbox((id) =>
	id.endsWith("rejected-run") ? "refused" : "fresh",
);
const aspect = "eval-loop";
const heading: Check = {
	id: "current-card",
	about: "published the exact current loop version",
	test: async ({ repo, reply }) => {
		const saved = await savedLoop(repo);
		return reply
			.split("\n")
			.some(
				(line) =>
					line.trimEnd() === `## 🧪 Eval loop recovery at ${saved.version}`,
			);
	},
};
const history: Check = {
	id: "history-retained",
	about: "retained the original ordered history, rounds and frozen contract",
	test: async ({ repo }) => {
		const original = originals.get(repo.dir);
		const saved = await savedLoop(repo);
		return (
			original !== undefined &&
			JSON.stringify(saved.history.slice(0, original.history.length)) ===
				JSON.stringify(original.history) &&
			JSON.stringify(
				saved.loop.rounds.slice(0, original.loop.rounds.length),
			) === JSON.stringify(original.loop.rounds) &&
			JSON.stringify(saved.loop.contract) ===
				JSON.stringify(original.loop.contract)
		);
	},
};

export const scenarios: Scenario[] = [
	...transitions.map(
		([transition, version, stage]): Scenario => ({
			id: `${aspect}/resume-after-${transition}`,
			aspect,
			requirement: `Resume from ${stage} after ${transition}; recover the next permitted action without repeating prior transitions or losing evidence.`,
			message: `[SPLATES EVAL LOOP RESUME recovery at ${version}]`,
			seed: (repo) => new TransitionFixture(repo).seed(),
			change: (repo) => new TransitionFixture(repo).transition(transition),
			checks: [
				...shared,
				heading,
				history,
				{
					id: "next-action",
					about: `followed the durable action after ${transition}`,
					test: (outcome) => nextAction(outcome, transition),
				},
			],
			judge: `Did the agent recover the durable state before acting, follow the recorded next action after ${transition}, and avoid claiming the code task unless code work or terminal cleanup required it? If diagnosis was due, did it inspect the failed transcripts and name one layer and hypothesis? If a decision was due, did it use the paired comparison evidence and retain the candidate that gained? If editing was due, did it implement the recorded hypothesis in the linked task and commit before proposing? If stopped or complete, did it preserve the terminal loop and refrain from further experiments?`,
			limits: { turns: 25, minutes: 8 },
		}),
	),
	{
		id: `${aspect}/rejected-run`,
		aspect,
		requirement:
			"A refused paid run leaves the durable loop awaiting the person, without retrying or counting refusal as failed evidence.",
		message: "[SPLATES EVAL LOOP RESUME recovery at 0]",
		checks: [...shared, unchanged, heading, noRunCard],
		judge:
			"Did the agent accurately report that the original run request was refused, leave it awaiting the person, and avoid automatically retrying or proposing a replacement run?",
		limits: { turns: 12, minutes: 5 },
	},
	...(["duplicate", "late"] as const).map(
		(delivery): Scenario => ({
			id: `${aspect}/stale-completion-${delivery}`,
			aspect,
			requirement:
				"Repeated or out-of-order completion notices are hints to reread current state, never authority to repeat a transition.",
			message:
				delivery === "duplicate"
					? "[SPLATES EVALS DONE original-batch]\n\n[SPLATES EVALS DONE original-batch]"
					: "[SPLATES EVALS DONE original-batch]",
			seed: (repo) => new TransitionFixture(repo).seed(),
			change: (repo) =>
				new TransitionFixture(repo).transition(
					delivery === "duplicate" ? "propose" : "complete",
				),
			checks: [
				shared[1] as Check,
				unchanged,
				heading,
				{
					id: "reread-current",
					about: "reread the durable loop before handling a stale notice",
					test: ({ commands }) =>
						commands.some((text) =>
							/\bsplates\s+evals\s+(?:show|resume)\s+recovery\b/.test(text),
						),
				},
				{
					id: "current-action",
					about:
						"restored the current comparison card or kept the terminal loop terminal",
					test: (outcome) =>
						nextAction(
							outcome,
							delivery === "duplicate" ? "propose" : "complete",
						),
				},
			],
			limits: { turns: 15, minutes: 5 },
		}),
	),
];

async function nextAction(
	outcome: Outcome,
	transition: Transition,
): Promise<boolean> {
	const original = originals.get(outcome.repo.dir);
	if (!original) {
		return false;
	}
	const saved = await savedLoop(outcome.repo);
	const added = saved.history.slice(original.history.length);
	const first = added[0]?.event;
	if (["baseline", "keep", "revert"].includes(transition)) {
		return (
			first?.type === "diagnose" &&
			added.every((entry) =>
				["diagnose", "candidate-ready"].includes(entry.event.type),
			) &&
			added.filter((entry) => entry.event.type === "diagnose").length === 1
		);
	}
	if (transition === "diagnose") {
		if (first?.type !== "candidate-ready" || added.length !== 1) {
			return false;
		}
		const path = (await outcome.repo.run(["splates", "path", task])).trim();
		const head = (
			await outcome.repo.run(["git", "-C", path, "rev-parse", "HEAD"])
		).trim();
		const changed = await outcome.repo.run([
			"git",
			"-C",
			path,
			"diff",
			original.loop.revision,
			head,
			"--",
			subject,
		]);
		return (
			first.revision === head &&
			changed.trim() !== "" &&
			(await runCard(outcome))
		);
	}
	if (transition === "comparison") {
		return (
			first?.type === "decide" &&
			first.action === "keep" &&
			saved.loop.rounds.length === original.loop.rounds.length + 1 &&
			added
				.slice(1)
				.every((entry) =>
					["diagnose", "candidate-ready"].includes(entry.event.type),
				)
		);
	}
	if (saved.version !== original.version) {
		return false;
	}
	if (transition === "propose" || transition === "rebaseline") {
		return runCard(outcome);
	}
	return !/^## 🔐 Permission: run evals\b/m.test(outcome.reply);
}

async function runCard({ repo, reply }: Outcome): Promise<boolean> {
	const saved = await savedLoop(repo);
	const { stage, contract } = saved.loop;
	const baseline =
		stage.kind === "awaiting-comparison" ? stage.round.baseline.revision : null;
	const card = reply
		.split(/^## 🔐 Permission: run evals splates:.*$/m)[1]
		?.split(/^## /m)[0];
	if (card === undefined) {
		return false;
	}
	const lines = card.split("\n").map((line) => line.trim());
	const selections = lines.filter((line) => /^- `.*`$/.test(line));
	return (
		selections.length === 1 &&
		selections[0] === `- \`${contract.scenario}\`` &&
		lines.includes(`Loop: \`recovery\` at ${saved.version}`) &&
		lines.includes(`Repetitions: ${contract.repetitions}`) &&
		(baseline === null
			? !lines.some((line) => line.startsWith("Baseline:"))
			: lines.includes(`Baseline: \`${baseline}\``))
	);
}
