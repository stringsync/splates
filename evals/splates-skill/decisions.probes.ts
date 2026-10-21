import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	APPROVE,
	MERGE,
	questions,
	unfinished,
} from "@stringsync/splates-server/plans";
import { FORMAT } from "@stringsync/splates-server/records";
import type { Assertion, Json, Probe } from "./probe";
import { command, seedFile, seedRepository } from "./probe-sandbox";
import type { ProbeModule, RunContext, Seed } from "./runner";

const source = ".agents/skills/splates/SKILL.md";
const task = "decision";
const basePlan = `# decision

## Goal

Exercise one isolated decision; no external services are available.

## Next

- [x] Prepare the local fixture

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
	const next = /^## Next\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(plan);
	return {
		"plan/next-context": /^[ \t]+\S/m.test(next?.[1] ?? ""),
		"plan/blocked": summarize(questions(plan)),
		"plan/blocked-kinds": questions(plan).map(({ number, size, done }) => ({
			number,
			size,
			done,
		})),
		"plan/review-requested": unfinished(plan).steps.some((step) =>
			/show the user before merging/i.test(step),
		),
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
	fingerprint: "decisions-task-v2:seedRepository-v1:production-plan-summary-v2",
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
		await seedFile(context, ".git/splates/format", `${FORMAT}\n`);
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
			"file/SPLATES.md": plan,
		};
	},
};
/** The repository alone, for a conversation with no task open. */
const conversationSeed: Seed = {
	id: "decisions/conversation",
	version: "1",
	fingerprint: "decisions-conversation-v1:seedRepository-v1",
	async prepare(context) {
		await seedRepository(context);
		await seedFile(context, ".git/splates/format", `${FORMAT}\n`);
	},
	async observe(context) {
		const listed = await command(context, ["splates", "list", "--json"]);
		const tasks = listed.exitCode === 0 ? JSON.parse(listed.stdout) : null;
		return { "tasks/open": Array.isArray(tasks) ? tasks.length : null };
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
		seed: { id: seed.id, version: seed.version, data: { plan } },
		input: {
			kind: input.startsWith("[SPLATES") ? "directive" : "message",
			origin: "user",
			text: `${input}\nThe existing task is decision; locate it with splates path decision. Stop this turn once the requested decision behavior is observable.`,
		},
		tools: ["shell", "read", "write"],
		evidence: ["state", "events", "reply"],
		assertions,
		stop: { kind: "reply" },
		bounds: { milliseconds: 600000, turns: 100, tokens: 1000000 },
		execution: { kind: "agent", skill: ".agents/skills/splates" },
	};
}
const conversationTalk =
	"No task is open, and I only want to talk this through before anything is built: should a retry limit live in config or stay a constant in the code? Weigh it, then ask me whatever my answer would change. Build nothing and start no task this turn.";
const reviewPlan = basePlan.replace(
	"## Next\n",
	"## Next\n\n- [ ] Show the user before merging\n",
);
export const probes: Probe[] = [
	probe(
		"local-choice",
		"decisions-local",
		"Questions",
		"Choose between three and five for a local retry-limit constant. This is a new decision, cheap to undo in one commit, with no data or external effects. Record your choice and its alternative under the relevant Next step; implementation continues in a later turn.",
		[state("plan/next-context", true), state("plan/blocked", []), ...noMerge],
	),
	probe(
		"external-blocker",
		"decisions-local",
		"Questions",
		"The only remaining step is to send a migration notice to customers. The recipient group has not been decided. Record that outward-facing decision and ask me; no sending service is available.",
		[
			state("plan/blocked-kinds", [
				{ number: "1", size: "large", done: false },
			]),
			state("task/status", "working"),
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
			state("task/status", "working"),
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
			state("task/status", "working"),
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
	),
	{
		...probe(
			"conversation-question",
			"decisions-conversation",
			"In every conversation",
			conversationTalk,
			[
				state("tasks/open", 0),
				{
					id: "numbered-question",
					kind: "reply",
					type: "questions",
					field: ["questions", "0", "number"],
					equals: "1",
				},
				{
					id: "chosen-first",
					kind: "reply",
					type: "questions",
					field: ["questions", "0", "choices", "0", "chosen"],
					equals: true,
				},
				gap(
					"conversation-question-content",
					"Whether the question is the one the design hinges on, and its choices sound, requires semantic/manual review.",
				),
				...noMerge,
			],
		),
		seed: {
			id: conversationSeed.id,
			version: conversationSeed.version,
			data: null,
		},
		input: { kind: "message", origin: "user", text: conversationTalk },
	},
];

/** Production directive constants, not CLI emission or agent compliance evidence. */
export const decisionDirectives = { approve: APPROVE, merge: MERGE };
export default {
	probes,
	seeds: [seed, conversationSeed],
} satisfies ProbeModule;
