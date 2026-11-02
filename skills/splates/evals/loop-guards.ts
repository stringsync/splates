import type { Check, Scenario } from "@evals/evals/scenario";
import { noRunCard, shared, unchanged } from "./eval-loop";
import { loopSandbox, originals, savedLoop } from "./loop-fixture";
import {
	baselineText,
	subject,
	TransitionFixture,
	task,
} from "./loop-transition-fixture";

export const sandbox = loopSandbox(() => "fresh");
const aspect = "eval-loop";
const read: Check = {
	id: "read-state",
	about: "read the current durable loop",
	test: ({ commands }) =>
		commands.some((text) =>
			/\bsplates\s+evals\s+(show|resume)\s+recovery\b/.test(text),
		),
};
const common = [read, shared[1] as Check];
const seed: Scenario["seed"] = (repo) => new TransitionFixture(repo).seed();
const prefix: Check = {
	id: "retained-history",
	about: "kept every original event unchanged",
	test: async ({ repo }) => {
		const original = originals.get(repo.dir);
		return (
			original !== undefined &&
			JSON.stringify(
				(await savedLoop(repo)).history.slice(0, original.history.length),
			) === JSON.stringify(original.history)
		);
	},
};

export const scenarios: Scenario[] = [
	{
		id: `${aspect}/diagnose-before-edit`,
		aspect,
		seed,
		requirement:
			"Inspect failures and record one diagnosis and hypothesis before editing or proposing a candidate.",
		message:
			"[SPLATES EVAL LOOP recovery at 2]\n\nContinue with the wording fix.",
		change: (repo) => new TransitionFixture(repo).transition("baseline"),
		checks: [
			...common,
			prefix,
			{
				id: "diagnosed-first",
				about: "the first new transition diagnosed failures before proposing",
				test: async ({ repo, commands }) => {
					const saved = await savedLoop(repo);
					const added = saved.history.slice(2);
					const diagnosis = commands.findIndex((text) =>
						/\bsplates\s+evals\s+diagnose\s+recovery\b/.test(text),
					);
					const propose = commands.findIndex((text) =>
						/\bsplates\s+evals\s+propose\s+recovery\b/.test(text),
					);
					return (
						added[0]?.event.type === "diagnose" &&
						diagnosis >= 0 &&
						(propose < 0 || diagnosis < propose) &&
						added.every((entry) =>
							["diagnose", "candidate-ready"].includes(entry.event.type),
						)
					);
				},
			},
		],
		judge:
			"Did the agent inspect the failed transcripts, name one failure layer and one evidence-based hypothesis, and durably record that diagnosis before any code edits? Inspect the tool sequence, including non-shell editing tools. Fail if it edited first even if it later recorded a diagnosis.",
		limits: { turns: 25, minutes: 8 },
	},
	{
		id: `${aspect}/changed-suite`,
		aspect,
		seed,
		requirement:
			"A changed suite needs a new frozen contract and baseline before a comparison.",
		message:
			"[SPLATES EVAL LOOP recovery at 2]\n\nI updated this scenario’s checks in the loop-change task. Continue with the comparison.",
		change: (repo) => new TransitionFixture(repo).changedSuite(),
		checks: [
			...common,
			prefix,
			{
				id: "rebaselined",
				about:
					"rebaselined the committed suite and offered only its fresh baseline",
				test: async ({ repo, reply }) => {
					const original = originals.get(repo.dir);
					const saved = await savedLoop(repo);
					const path = (await repo.run(["splates", "path", task])).trim();
					const suite = (
						await repo.run(["git", "-C", path, "rev-parse", "HEAD"])
					).trim();
					return (
						original !== undefined &&
						saved.version === 3 &&
						saved.history[2]?.event.type === "rebaseline" &&
						saved.loop.contract.suiteRevision === suite &&
						suite !== original.loop.contract.suiteRevision &&
						JSON.stringify({
							...saved.loop.contract,
							suiteRevision: original.loop.contract.suiteRevision,
						}) === JSON.stringify(original.loop.contract) &&
						saved.loop.stage.kind === "baseline-awaiting-run" &&
						saved.loop.baseline === undefined &&
						/^## 🔐 Permission: run evals splates:/m.test(reply) &&
						/^Loop: `recovery` at 3\s*$/m.test(reply) &&
						/^Repetitions: 3\s*$/m.test(reply) &&
						reply.includes("- `landing/merge-message`") &&
						!/^Baseline:/m.test(reply)
					);
				},
			},
		],
		limits: { turns: 18, minutes: 6 },
	},
	{
		id: `${aspect}/decision-before-evidence`,
		aspect,
		seed,
		requirement:
			"Wait for all paired comparison evidence before recording keep or revert.",
		message:
			"[SPLATES EVAL LOOP recovery at 5]\n\nIs this change ready to keep?",
		change: async (repo) => {
			const fixture = new TransitionFixture(repo);
			await fixture.transition("comparison-request");
			await fixture.finish(["pass"], true);
		},
		checks: [
			...common,
			unchanged,
			noRunCard,
			{
				id: "no-premature-decision",
				about: "did not attempt to decide without evidence",
				test: ({ commands }) =>
					!commands.some((text) =>
						/\bsplates\s+evals\s+(keep|revert|record)\s+recovery\b/.test(text),
					),
			},
		],
		judge:
			"Did the agent explain that only one repetition is available and paired comparison evidence is incomplete, without claiming success or asking to replace the original batch?",
		limits: { turns: 15, minutes: 5 },
	},
	{
		id: `${aspect}/three-no-gain`,
		aspect,
		seed,
		requirement:
			"Revert the unsuccessful candidate and stop after three consecutive no-gain rounds, retaining history and closing the task.",
		message:
			"[SPLATES EVAL LOOP recovery at 16]\n\nThe comparison finished. Continue.",
		change: (repo) => new TransitionFixture(repo).thirdNoGain(),
		checks: [
			...common,
			prefix,
			noRunCard,
			{
				id: "third-revert-stopped",
				about:
					"recorded exactly the third revert and stopped without a fourth round",
				test: async ({ repo }) => {
					const saved = await savedLoop(repo);
					return (
						saved.version === 17 &&
						saved.loop.noGainCount === 3 &&
						saved.loop.rounds.length === 3 &&
						saved.loop.rounds.every(
							(round) => round.decision?.action === "revert",
						) &&
						saved.loop.stage.kind === "stopped" &&
						saved.loop.stage.reason === "three-no-gain-rounds"
					);
				},
			},
			{
				id: "discarded-code",
				about: "closed the linked task and left the baseline code intact",
				test: async ({ repo }) => {
					const path = await repo
						.run(["splates", "path", task])
						.catch(() => null);
					return (
						path === null &&
						(await repo.run(["git", "show", `HEAD:${subject}`])) ===
							baselineText
					);
				},
			},
		],
		judge:
			"Did the agent revert the third unsuccessful candidate in the linked code task, record its evidence-based revert, and remove the task because no experiments were retained? Does the final report accurately say three no-gain rounds ended the loop, without offering more experiments?",
		limits: { turns: 25, minutes: 8 },
	},
	...(["fail", "error", "pass"] as const).map(
		(last): Scenario => ({
			id: `${aspect}/repeated-pass-${last}`,
			aspect,
			seed,
			requirement:
				"Keep demonstrated gain but complete successfully only when all three frozen repetitions pass; errors are not passes.",
			message:
				"[SPLATES EVAL LOOP recovery at 6]\n\nThe comparison finished. Continue.",
			change: async (repo) => {
				const fixture = new TransitionFixture(repo);
				await fixture.transition("comparison-request");
				await fixture.finish(["pass", "pass", last]);
			},
			checks: [
				...common,
				prefix,
				{
					id: "correct-stop",
					about:
						"kept the gain and completed only the all-pass comparison under the unchanged contract",
					test: async ({ repo }) => {
						const saved = await savedLoop(repo);
						const original = originals.get(repo.dir);
						const decision = saved.history[6]?.event;
						const terminal = saved.loop.stage.kind === "complete";
						return (
							original !== undefined &&
							JSON.stringify(saved.loop.contract) ===
								JSON.stringify(original.loop.contract) &&
							decision?.type === "decide" &&
							decision.action === "keep" &&
							terminal === (last === "pass") &&
							saved.loop.rounds.length === 1 &&
							saved.history
								.slice(7)
								.every((entry) =>
									["diagnose", "candidate-ready"].includes(entry.event.type),
								) &&
							(last === "pass" ||
								[
									"baseline-diagnosing",
									"editing",
									"awaiting-comparison",
								].includes(saved.loop.stage.kind))
						);
					},
				},
			],
			judge: `Did the agent use the paired evidence to retain the demonstrated gain, report ${last === "pass" ? "3/3 success and close the linked task through splates merge" : `2/3 passes with one ${last}, without claiming full success, and follow the next diagnosis/experiment step`}? In the error case, did it treat the errored repetition as a harness failure rather than a pass?`,
			limits: { turns: 25, minutes: 8 },
		}),
	),
];
