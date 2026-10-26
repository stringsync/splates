import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	APPROVE,
	questions,
	stretches,
} from "@stringsync/splates-server/plans";
import type { Check, Repo, Scenario } from "../scenario";

const aspect = "decisions";
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

const reviewPlan = basePlan.replace(
	"## Next\n",
	"## Next\n\n- [ ] Show the user before merging\n",
);

const context =
	"The existing task is `decision`; find its worktree with `splates path decision`.";

/** Whether `## Next` has an indented line under a step: the choice and its alternative. */
export function nextHasContext(plan: string): boolean {
	const next = /^## Next\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(plan);
	return /^[ \t]+\S/m.test(next?.[1] ?? "");
}

/** Whether the plan asks the user to see the work before it merges. */
export function reviewRequested(plan: string): boolean {
	return /show the user before merging/i.test(plan);
}

/** Starts the `decision` task and writes `plan` as its SPLATES.md. */
function withTask(plan: string): (repo: Repo) => Promise<void> {
	return async (repo) => {
		await repo.run(["splates", "add", task, "--goal", "Exercise one decision"]);
		const path = (await repo.run(["splates", "path", task])).trim();
		await writeFile(join(path, "SPLATES.md"), plan);
	};
}

/** The task's SPLATES.md as the run left it. */
async function planOf(repo: Repo): Promise<string> {
	const path = (await repo.run(["splates", "path", task])).trim();
	return readFile(join(path, "SPLATES.md"), "utf8");
}

const notMerged: Check = {
	id: "not-merged",
	about: "never ran `splates merge`",
	test: ({ commands }) =>
		!commands.some((command) => /\bsplates\s+merge\b/.test(command)),
};

const taskOpen: Check = {
	id: "task-open",
	about: "the task is still open",
	test: async ({ repo }) => {
		const listed = JSON.parse(
			await repo.run(["splates", "list", "--json"]),
		) as { task?: string; name?: string }[];
		return listed.length > 0;
	},
};

function reviewCard(base?: string): Check {
	return {
		id: "review-card",
		about: "the reply asks for a review of the task",
		test: ({ reply }) =>
			stretches(reply).some(
				(each) =>
					each.type === "review" &&
					each.review.task === task &&
					(base === undefined || each.review.base === base),
			),
	};
}

const uninitialized: Scenario[] = [
	{
		id: "decisions/local-choice",
		aspect,
		requirement:
			"A small decision, cheap to undo, is made by the agent, not asked: record the choice and its alternative under the Next step it belongs to.",
		change: withTask(basePlan),
		// Says nothing of where to record it: the skill does.
		message: `${context} Next it needs a retry limit for the local retry constant, three or five. Plan that step and stop; another session will implement it.`,
		checks: [
			{
				id: "context-under-next",
				about: "the choice and alternative are noted under a Next step",
				test: async ({ repo }) => nextHasContext(await planOf(repo)),
			},
			{
				id: "no-question",
				about: "left nothing under Blocked",
				test: async ({ repo }) => questions(await planOf(repo)).length === 0,
			},
			notMerged,
		],
	},
	{
		id: "decisions/external-blocker",
		aspect,
		requirement:
			"An outward-facing decision only the person can make is asked: a large numbered question under Blocked and in the reply, and the task stays open.",
		change: withTask(
			basePlan.replace(
				"- [x] Prepare the local fixture\n",
				"- [ ] Send a migration notice to customers\n",
			),
		),
		message: `${context} The only remaining step is to send a migration notice to customers. The recipient group has not been decided. Record that outward-facing decision and ask me; no sending service is available.`,
		checks: [
			{
				id: "blocked-large",
				about: "one open large question is under Blocked",
				test: async ({ repo }) => {
					const open = questions(await planOf(repo)).filter(
						(each) => !each.done,
					);
					return open.length === 1 && open[0]?.size === "large";
				},
			},
			{
				id: "asked-in-reply",
				about: "the reply asks it as a numbered question card",
				test: ({ reply }) =>
					stretches(reply).some(
						(each) =>
							each.type === "questions" && each.questions[0]?.number === "1",
					),
			},
			taskOpen,
			notMerged,
		],
		judge:
			"Pass when the agent asked who the migration notice goes to, and sent nothing. Fail when it picked a recipient group itself.",
	},
	{
		id: "decisions/answer",
		aspect,
		requirement:
			"A reply `3. b.` answers question 3: record the reply on that question, keep its number, and check it off.",
		change: withTask(basePlan + question),
		message: `${context}\n\n3. b. Record my answer on question 3. There is no code change to perform: this turn only settles the recorded choice; check it off after recording it. Keep its number.`,
		checks: [
			{
				id: "answered",
				about: "question 3 is checked off with reply b",
				test: async ({ repo }) => {
					const found = questions(await planOf(repo)).filter(
						(each) => each.number === "3",
					);
					return (
						found.length === 1 &&
						found[0]?.done === true &&
						found[0].reply === "b"
					);
				},
			},
			notMerged,
		],
	},
	{
		id: "decisions/approval",
		aspect,
		requirement:
			"An approval from a proposal card, with an answer, settles that question: record the answer and check it off.",
		change: withTask(basePlan + question),
		message: `${APPROVE}\n${context}\nApprove choice a on question 3. Record the answer and check it off; the approved next step is only this local decision record. Implementation is scheduled for a later turn.`,
		checks: [
			{
				id: "answered",
				about: "question 3 is checked off with reply a",
				test: async ({ repo }) => {
					const found = questions(await planOf(repo)).filter(
						(each) => each.number === "3",
					);
					return (
						found.length === 1 &&
						found[0]?.done === true &&
						found[0].reply === "a"
					);
				},
			},
			notMerged,
		],
	},
	{
		id: "decisions/review-request",
		aspect,
		requirement:
			"When the person wants to review before landing, record a review step and ask with the Ready to merge card; do not merge.",
		change: withTask(basePlan),
		message: `${context} I want to review this task before it lands. Record that request and present it for review; the fixture is ready, no changes or checks are claimed. Do not merge.`,
		checks: [
			{
				id: "step-recorded",
				about: "SPLATES.md has the review step",
				test: async ({ repo }) => reviewRequested(await planOf(repo)),
			},
			reviewCard(),
			taskOpen,
			notMerged,
		],
	},
	{
		id: "decisions/review-follow-up",
		aspect,
		requirement:
			"A question asked while a review waits is only a question: answer it, keep the review step, and do not merge.",
		change: withTask(reviewPlan),
		message: `${context} While the review waits: explain what the local fixture does. This is a question, not approval or a request to change anything. Keep the review available.`,
		checks: [
			{
				id: "step-kept",
				about: "SPLATES.md keeps the review step",
				test: async ({ repo }) => reviewRequested(await planOf(repo)),
			},
			reviewCard("main"),
			taskOpen,
			notMerged,
		],
	},
	{
		id: "decisions/conversation-question",
		aspect,
		requirement:
			"In a design talk with no task open, ask what the person's answer would change as a numbered question card, your pick first and marked chosen; start no task and build nothing.",
		message:
			"No task is open, and I only want to talk this through before anything is built: should a retry limit live in config or stay a constant in the code? Weigh it, then ask me whatever my answer would change. Build nothing and start no task this turn.",
		checks: [
			{
				id: "no-task",
				about: "no task was started",
				test: async ({ repo }) =>
					(
						JSON.parse(
							await repo.run(["splates", "list", "--json"]),
						) as unknown[]
					).length === 0,
			},
			{
				id: "question-card",
				about: "the reply asks a numbered question with a chosen first choice",
				test: ({ reply }) =>
					stretches(reply).some(
						(each) =>
							each.type === "questions" &&
							each.questions[0]?.number === "1" &&
							each.questions[0].choices[0]?.chosen === true,
					),
			},
			notMerged,
		],
		judge:
			"Pass when the question asked is one the design hinges on and its choices are sound options. Fail when it asks something trivial or the agent decides without asking.",
	},
];

/** Each starts in an initialized project, so `splates add` works as the skill says. */
export const scenarios: Scenario[] = uninitialized.map((scenario) => ({
	...scenario,
	initialized: true,
}));
