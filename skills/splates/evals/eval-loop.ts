import type { Check, Outcome, Scenario } from "@evals/evals/scenario";
import {
	caseId,
	loopId,
	loopSandbox,
	noPaidAttempt,
	originals,
	savedLoop,
} from "./loop-fixture";

export const sandbox = loopSandbox((id) => {
	if (id.endsWith("fresh-baseline")) {
		return "fresh";
	}
	if (id.endsWith("lost-completion")) {
		return "finished";
	}
	return id.endsWith("interrupted-process") ? "interrupted" : "running";
});
const aspect = "eval-loop";
const resume = `[SPLATES EVAL LOOP RESUME ${loopId} at 0]`;
const command = (outcome: Outcome, verb: string) =>
	outcome.commands.findIndex((text) =>
		new RegExp(`\\bsplates\\s+evals\\s+${verb}\\s+${loopId}\\b`).test(text),
	);
export const shared: Check[] = [
	{
		id: "resume-read",
		about: "read durable recovery state",
		test: (outcome) => command(outcome, "resume") !== -1,
	},
	{
		id: "no-paid-run",
		about: "never executed an eval",
		test: async (outcome) =>
			(await noPaidAttempt(outcome.repo)) &&
			!outcome.commands.some((text) =>
				/\b(?:splates\s+dev\s+eval|evals)\s+run\b/.test(text),
			),
	},
];
export const unchanged: Check = {
	id: "state-preserved",
	about: "preserved the frozen loop and its entire history",
	test: async ({ repo }) => {
		const saved = await savedLoop(repo);
		const original = originals.get(repo.dir);
		return (
			original !== undefined &&
			saved.version === original.version &&
			JSON.stringify(saved.loop) === JSON.stringify(original.loop) &&
			JSON.stringify(saved.history) === JSON.stringify(original.history)
		);
	},
};
const heading: Check = {
	id: "current-heading",
	about: "published the recovered card at version zero",
	test: ({ reply }) => /^## 🧪 Eval loop recovery at 0\s*$/m.test(reply),
};
export const noRunCard: Check = {
	id: "no-duplicate-card",
	about: "did not offer another paid run",
	test: ({ reply }) => !/^## 🔐 Permission: run evals\b/m.test(reply),
};

export const scenarios: Scenario[] = [
	{
		id: `${aspect}/fresh-baseline`,
		aspect,
		requirement:
			"Recover the durable loop in a fresh conversation and offer its frozen baseline run card without starting a run.",
		message: resume,
		checks: [
			...shared,
			unchanged,
			heading,
			{
				id: "baseline-card",
				about:
					"offered the frozen scenario and repetitions linked to this loop, without a comparison baseline",
				test: ({ reply }) =>
					/^## 🔐 Permission: run evals splates:/m.test(reply) &&
					reply.includes(`- \`${caseId}\``) &&
					/^Loop: `recovery` at 0\s*$/m.test(reply) &&
					/^Repetitions: 3\s*$/m.test(reply) &&
					!/^Baseline:/m.test(reply),
			},
			{
				id: "no-premature-task",
				about: "did not claim a code task or pre-record a request",
				test: (outcome) =>
					command(outcome, "request") === -1 &&
					!outcome.commands.some((text) =>
						/\bsplates\s+(?:claim|add)\b/.test(text),
					),
			},
		],
		limits: { turns: 12, minutes: 5 },
	},
	...(["running", "process"] as const).map(
		(kind): Scenario => ({
			id: `${aspect}/${kind === "running" ? "interrupted-running" : "interrupted-process"}`,
			aspect,
			requirement:
				"Recover an existing launch after interruption without replacing it; inspect interrupted evidence and await the person when it cannot be completed.",
			message: `${resume}\n\nThe connection dropped while this was running. Continue.`,
			checks: [
				...shared,
				unchanged,
				heading,
				noRunCard,
				{
					id: "original-run",
					about: "reported the original request or batch",
					test: ({ reply }) =>
						reply.includes("original-request") ||
						(kind === "process" && reply.includes("original-batch")),
				},
			],
			judge:
				kind === "running"
					? "Did the agent recover the original running request, accurately report that no batch is linked yet, and avoid claiming completion or offering a replacement run?"
					: "Did the agent inspect the existing original-batch evidence, recognize that only one of three repetitions finished and the process stopped, and ask the person what to do without offering or starting a replacement automatically?",
			limits: { turns: 15, minutes: 5 },
		}),
	),
	{
		id: `${aspect}/lost-completion`,
		aspect,
		requirement:
			"Recover a finished batch with a lost notice by reconciling its original evidence once, then diagnose failures before editing.",
		message: `${resume}\n\nThe server restarted after the batch finished, before its completion message arrived. Continue.`,
		checks: [
			...shared,
			{
				id: "reconciled-after-resume",
				about:
					"reconciled the original batch after reading recovery state and showed it again",
				test: (outcome) =>
					command(outcome, "reconcile") > command(outcome, "resume") &&
					command(outcome, "show") > command(outcome, "reconcile"),
			},
			{
				id: "evidence-once",
				about:
					"retained the three original failures with one request and completion",
				test: async ({ repo }) => {
					const saved = await savedLoop(repo);
					const [request, completion, diagnosis] = saved.history;
					return (
						request?.id === "run-original-batch" &&
						completion?.id === "done-original-batch" &&
						completion.event.type === "finish-batch" &&
						JSON.stringify(completion.event.completion.results) ===
							'["fail","fail","fail"]' &&
						diagnosis?.event.type === "diagnose" &&
						diagnosis.event.hypothesis.trim() !== "" &&
						saved.history.filter(
							(entry) =>
								entry.event.type === "finish-batch" &&
								entry.event.completion.batch.id === "original-batch",
						).length === 1
					);
				},
			},
		],
		judge:
			"Did the agent inspect all three failed run transcripts, diagnose their shared failure to land via splates merge in exactly one layer, record one evidence-based hypothesis before any code edits, and publish the resulting current guided card? Reading the original detail files is equivalent to opening them through the CLI. Fail if it fabricated evidence or treated reconciliation as a diagnosis.",
		limits: { turns: 25, minutes: 8 },
	},
];
