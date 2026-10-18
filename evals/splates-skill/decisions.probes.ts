import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	APPROVE,
	assumptions,
	MERGE,
	questions,
} from "@stringsync/splates-server/plans";
import type { Assertion, Json, Probe } from "./probe";
import { command, seedFile, seedRepository } from "./probe-sandbox";
import type { ProbeModule, RunContext, Seed } from "./runner";

const source = ".agents/skills/splates/SKILL.md";
const task = "decision";
const basePlan = `# decision

## Goal

Exercise one isolated decision; no external services are available.

## Done

## Next

- [x] Prepare the local fixture

## Notes

## Assumptions

## Blocked
`;
const question = `- [ ] 3. (small) Which local retry limit?
  - (a) Three (chosen)
  - (b) Five
`;

/** Selected production-parser fields; wording is deliberately not graded. */
export function decisionState(plan: string): Record<string, Json> {
	const summarize = (items: ReturnType<typeof questions>) =>
		items.map((item) => ({
			number: item.number,
			done: item.done,
			size: item.size,
			reply: item.reply,
			chosen: item.choices
				.filter((choice) => choice.chosen)
				.map((choice) => choice.key),
		}));
	return {
		"plan/assumptions": summarize(assumptions(plan)),
		"plan/blocked": summarize(questions(plan)),
		"plan/blocked-kinds": questions(plan).map(({ number, size, done }) => ({
			number,
			size,
			done,
		})),
		"plan/review-requested": /^Review: requested$/m.test(plan),
	};
}

async function checked(context: RunContext, argv: string[]) {
	const result = await command(context, argv);
	if (result.exitCode !== 0) {
		throw new Error(result.stderr || result.stdout);
	}
	return result.stdout.trim();
}

const seed: Seed = {
	id: "decisions/task",
	version: "1",
	fingerprint: "decisions-task-v1:seedRepository-v1:production-plan-summary-v1",
	async prepare(context, data) {
		if (
			typeof data !== "object" ||
			data === null ||
			Array.isArray(data) ||
			typeof data.plan !== "string"
		) {
			throw new Error("decision seed requires plan text");
		}
		await seedRepository(context);
		// Minimal versioned local records, without init/network/skill installation.
		await seedFile(context, ".git/splates/format", "1\n");
		await checked(context, [
			"splates",
			"add",
			task,
			"--goal",
			"Exercise one decision",
		]);
		const path = await checked(context, ["splates", "path", task]);
		context.runtime.decisionPath = path;
		await writeFile(join(path, "SPLATES.md"), data.plan);
		if (data.waiting === true) {
			await checked(context, [
				"splates",
				"escalate",
				"review fixture",
				"--review",
				"--task",
				task,
			]);
		}
	},
	async observe(context) {
		const path = context.runtime.decisionPath;
		if (typeof path !== "string") {
			throw new Error("missing decision task path");
		}
		const read = async (name: string) => {
			try {
				return await readFile(join(path, name), "utf8");
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") {
					return null;
				}
				throw error;
			}
		};
		const plan = await read("SPLATES.md");
		const shown = await command(context, ["splates", "show", task, "--json"]);
		const details = shown.exitCode === 0 ? JSON.parse(shown.stdout) : null;
		return {
			...(plan === null ? {} : decisionState(plan)),
			"task/status": details?.status ?? null,
			"task/review": typeof details?.review === "string",
			"file/SPLATES.md": plan,
		};
	},
};
const state = (key: string, equals: Json): Assertion => ({
	id: key,
	kind: "state",
	key,
	equals,
});
const gap = (id: string, reason: string): Assertion => ({
	id,
	kind: "uncovered",
	reason,
});
const noMerge: Assertion[] = [
	{
		id: "no-canonical-merge",
		kind: "count",
		match: {
			actor: "agent",
			kind: "command",
			name: "splates",
			args: ["merge"],
		},
		min: 0,
		max: 0,
	},
	gap(
		"merge-argv-gap",
		"Canonical merge prohibition does not cover alternate argv, nested shells or direct git. Complete normalized verb capture is required for full premature-landing coverage.",
	),
];
const summary = (
	number: string,
	size: string,
	opts: { done?: boolean; reply?: string | null } = {},
) => ({
	number,
	size,
	done: opts.done ?? false,
	reply: opts.reply ?? null,
	chosen: ["a"],
});
function probe(
	id: string,
	requirement: string,
	section: string,
	input: string,
	assertions: Assertion[],
	plan = basePlan,
	waiting = false,
): Probe {
	return {
		schema: 1,
		id: `decisions/${id}`,
		version: "1",
		aspect: "decisions",
		requirement: {
			id: requirement,
			text: input,
			source: `${source}#${section}`,
		},
		seed: { id: seed.id, version: seed.version, data: { plan, waiting } },
		input: {
			kind: input.startsWith("[SPLATES") ? "directive" : "message",
			origin: "user",
			text: `${input}\nThe existing task is decision; locate it with splates path decision. Stop this turn once the requested decision behavior is observable.`,
		},
		tools: ["shell", "read", "write"],
		evidence: ["state", "events", "reply"],
		assertions,
		stop: { kind: "reply" },
		bounds: { milliseconds: 60000, turns: 1, tokens: 4000 },
		execution: { kind: "agent", skill: ".agents/skills/splates" },
	};
}
const reviewPlan = basePlan.replace(
	"## Notes\n",
	"## Notes\n\nReview: requested\n",
);
export const probes: Probe[] = [
	probe(
		"local-choice",
		"decisions-local",
		"Asking as you go",
		"Choose between three and five for a local retry-limit constant. This is a new decision, cheap to undo in one commit, with no data or external effects. Record your choice and its alternative; implementation continues in a later turn.",
		[
			state("plan/assumptions", [summary("1", "small")]),
			state("plan/blocked", []),
			{
				id: "assumption-report",
				kind: "reply",
				type: "assumed",
				field: ["assumed", "0", "number"],
				equals: "1",
			},
			...noMerge,
		],
	),
	probe(
		"external-blocker",
		"decisions-local",
		"Escalation",
		"The only remaining step is to send a migration notice to customers. The recipient group has not been decided. Record that outward-facing decision and escalate; no sending service is available.",
		[
			state("plan/assumptions", []),
			state("plan/blocked-kinds", [
				{ number: "1", size: "large", done: false },
			]),
			state("task/status", "escalated"),
			gap(
				"external-decision-content",
				"Recipient question meaning and absence of all external effects require semantic/manual review and an instrumented external boundary.",
			),
			{
				id: "numbered-question",
				kind: "reply",
				type: "questions",
				field: ["questions", "0", "number"],
				equals: "1",
			},
			...noMerge,
		],
	),
	probe(
		"answer",
		"decisions-local",
		"Keeping Blocked current",
		"3. b. Record my answer on question 3. There is no code change to perform: this turn only settles the recorded choice; check it off after recording it. Keep its number.",
		[
			state("plan/blocked", [
				summary("3", "small", { done: true, reply: "b" }),
			]),
			...noMerge,
		],
		basePlan + question,
	),
	probe(
		"approval",
		"decisions-approval",
		"Proposing",
		`${APPROVE}\nApprove choice a on question 3. Record the answer and check it off; the approved next step is only this local decision record. Implementation is scheduled for a later turn.`,
		[
			state("plan/blocked", [
				summary("3", "small", { done: true, reply: "a" }),
			]),
			...noMerge,
		],
		basePlan + question,
	),
	probe(
		"review-request",
		"decisions-review",
		"Merge or review",
		"I want to review this task before it lands. Record that request and present it for review; the fixture is ready, no changes or checks are claimed. Do not merge.",
		[
			state("plan/review-requested", true),
			state("task/status", "escalated"),
			state("task/review", true),
			{
				id: "review-task",
				kind: "reply",
				type: "review",
				field: ["review", "task"],
				equals: task,
			},
			...noMerge,
		],
	),
	probe(
		"review-follow-up",
		"decisions-review",
		"Reporting",
		"While the review waits: explain what the local fixture does. This is a question, not approval or a request to change anything. Keep the review available.",
		[
			state("plan/review-requested", true),
			state("task/status", "escalated"),
			state("task/review", true),
			{
				id: "review-task",
				kind: "reply",
				type: "review",
				field: ["review", "task"],
				equals: task,
			},
			{
				id: "review-base",
				kind: "reply",
				type: "review",
				field: ["review", "base"],
				equals: "main",
			},
			gap(
				"review-coherence",
				"Existential parsed fields do not establish one coherent complete report, demo quality, check truth or truthful verification claims.",
			),
			...noMerge,
		],
		reviewPlan,
		true,
	),
];

for (const blocked of [false, true]) {
	const cli = probe(
		blocked ? "cli-review-blocked" : "cli-review-ready",
		"decisions-review",
		"Merge or review",
		"CLI review readiness gate",
		[
			state("task/status", blocked ? "working" : "escalated"),
			state("task/review", !blocked),
		],
		blocked ? basePlan + question : basePlan,
	);
	cli.execution = {
		kind: "cli",
		command: [
			"splates",
			"escalate",
			"review fixture",
			"--review",
			"--task",
			task,
		],
	};
	cli.stop = {
		kind: "event",
		match: {
			actor: "cli",
			kind: "command",
			name: "splates",
			exitCode: blocked ? 16 : 0,
		},
	};
	cli.tools = [];
	cli.evidence = ["state"];
	probes.push(cli);
}

/** Production directive constants, not CLI emission or agent compliance evidence. */
export const decisionDirectives = { approve: APPROVE, merge: MERGE };
export default { probes, seeds: [seed] } satisfies ProbeModule;
