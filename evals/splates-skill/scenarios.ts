import { STARTS } from "./checks";
import { SEEDED } from "./fixture";
import {
	ADDED,
	IDLE,
	LANE,
	NO_DEV,
	PARALLEL,
	PIVOT_LANE,
	SAME_FILES,
	UNTRIAGED,
} from "./lanes";
import { lastSaid, openQuestions, splatesRuns, turnsOf } from "./reading";
import { CHECKPOINT } from "./resumed";
import { CORE, type Scenario } from "./scenario";

export const SCENARIOS: readonly Scenario[] = [
	{
		id: "queue",
		turns: ["[SPLATES TASK #1]"],
		sections: [
			...CORE,
			"Queueing tasks",
			"SPLATES.md",
			"Committing",
			"Merge or review",
			"Questions",
		],
		checks: [
			STARTS,
			{
				id: "took-queued",
				rule: "Reads the queued task, then adds a started task taking it",
				judge: ({ log }) => {
					const runs = splatesRuns(log.transcript.beats);
					const show = runs.findIndex(
						(run) =>
							run.verb === "task" &&
							run.args[0] === "show" &&
							run.args[1] === "1",
					);
					const add = runs.findIndex(
						(run) => run.verb === "add" && takes(run.args, "1"),
					);
					const ok = show !== -1 && add !== -1 && show < add;
					return [
						{
							ok,
							why: ok
								? "showed #1, then took it"
								: show === -1
									? "never showed #1"
									: "did not add it with --task 1",
						},
					];
				},
			},
			{
				id: "ended",
				rule: "Lands the fix or escalates it",
				judge: ({ end }) => {
					const ok =
						end.main.length > SEEDED ||
						end.tasks.some((task) => task.status === "escalated");
					return [
						{ ok, why: ok ? "landed or escalated" : "left the task under way" },
					];
				},
			},
		],
		rubric: [],
	},
	{
		id: "ask",
		turns: ["Add a cap on how many times an upload retries."],
		sections: [
			...CORE,
			"Questions",
			"Keeping Blocked current",
			"Escalation",
			"SPLATES.md",
		],
		checks: [
			STARTS,
			{
				id: "held",
				rule: "Merges only once no question is open",
				judge: ({ end }) => {
					const open = end.tasks.flatMap((task) =>
						openQuestions(task.plan ?? ""),
					);
					const ok =
						open.length === 0
							? end.main.length > SEEDED
							: end.tasks.some((task) => task.status === "escalated");
					return [
						{
							ok,
							why:
								open.length === 0
									? ok
										? "merged"
										: "neither merged nor asked"
									: ok
										? "escalated with questions open"
										: "questions open, not escalated",
						},
					];
				},
			},
		],
		rubric: [
			"calls-right: the agent settled what the request leaves open, such as the cap's number and what happens once it is reached, and handled each call where the skill puts it: a question under `## Blocked`, with a `(chosen)` pick, when the user's answer would change what gets built, as the cap's number and what happens at it would, when undoing it reaches past the repo's code, or when a wrong guess would cost much rework; made itself and noted under `## Notes` only when the user would not care to weigh in",
		],
	},
	LANE,
	PARALLEL,
	SAME_FILES,
	ADDED,
	IDLE,
	PIVOT_LANE,
	NO_DEV,
	{
		id: "defer",
		turns: [
			"Note for later, no code now: uploads should show a progress bar. It's a fast follow, and it builds on the 413 fix in #1, which has to land first.",
		],
		sections: [
			...CORE,
			"Queueing tasks",
			"Linking, placing and ordering tasks",
			"Links",
			"Lanes",
			"Positions",
		],
		checks: [
			{
				id: "no-task",
				rule: "Adds no task when no code is asked for",
				judge: ({ log }) => {
					const added = splatesRuns(log.transcript.beats).filter(
						(run) => run.verb === "add",
					);
					return [
						{ ok: added.length === 0, why: `${added.length} tasks added` },
					];
				},
			},
			{
				id: "placed",
				rule: "Adds the queued task blocked by #1, in lane 1, near the top after reading the list",
				judge: ({ log, end }) => {
					const added = end.queued.find((each) => each.id === 4);
					if (added === undefined) {
						return [{ ok: false, why: "no queued task added" }];
					}
					const runs = splatesRuns(log.transcript.beats);
					const read = runs.findIndex(
						(run) => run.verb === "task" && run.args[0] === "list",
					);
					const placed = runs.findLastIndex(
						(run) =>
							run.verb === "task" &&
							["add", "update"].includes(run.args[0] ?? ""),
					);
					const problems = [
						...((added.blockedBy as number[]).includes(1)
							? []
							: ["not blocked by #1"]),
						...(added.lane === 1 ? [] : [`in lane ${added.lane}`]),
						...((added.position as number) <= 2
							? []
							: [`at position ${added.position}`]),
						...(read !== -1 && read < placed
							? []
							: ["placed without reading the list"]),
					];
					return [
						{ ok: problems.length === 0, why: problems.join("; ") || "placed" },
					];
				},
			},
			{
				id: "added-line",
				rule: "Keeps the new task's subject plain, and leaves heading it to its event line",
				judge: ({ log, end }) => {
					const added = end.queued.find((each) => each.id === 4);
					const subject = String(added?.subject ?? "");
					const headed = TASK_HEADING.test(lastSaid(log.transcript.beats));
					const problems = [
						...(added === undefined ? ["no queued task added"] : []),
						...(subject.includes("📝") ? ["📝 in the subject"] : []),
						...(headed ? ["headed the added task"] : []),
					];
					return [
						{
							ok: problems.length === 0,
							why: problems.join("; ") || "left to its line",
						},
					];
				},
			},
		],
		rubric: [],
	},
	{
		id: "part",
		turns: [
			"[SPLATES TASK #1]\n\nHand the tests for this to a subagent while you write the fix.",
		],
		sections: [
			...CORE,
			"Handing out part of your task",
			"Committing",
			"Questions",
		],
		checks: [
			STARTS,
			{
				id: "part-added",
				rule: "Adds the part on its own task's branch",
				judge: ({ log }) => {
					const part = splatesRuns(log.transcript.beats).find(
						(run) =>
							run.verb === "add" &&
							(run.args[run.args.indexOf("--base") + 1] ?? "").startsWith(
								"task/",
							),
					);
					return [
						{
							ok: part !== undefined,
							why:
								part === undefined ? "no part added" : `added ${part.args[0]}`,
						},
					];
				},
			},
			{
				id: "part-landed",
				rule: "Lands the part on its task, then one commit on main",
				judge: ({ end }) => {
					const part = end.landed.some((each) => each.base.startsWith("task/"));
					const onMain = end.main.length - SEEDED;
					return [
						{
							ok: part && onMain === 1,
							why: `${part ? "part landed" : "no part landed"}; ${onMain} commits on main`,
						},
					];
				},
			},
		],
		rubric: [
			"subagent-brief: the subagent's prompt told it to `splates claim <part>` and work only in that worktree; not to escalate, report to the user, or take tasks; to make each unsettled call itself and list in its reply what it chose and what else it could have done, never under `## Blocked`; and to squash and `splates merge` the part",
			"calls-recorded: each call the subagent listed was written by the parent under its own `## Notes`, or as a question under `## Blocked` when it needs the user (n/a when it listed none)",
		],
	},
	CHECKPOINT,
	{
		id: "review-again",
		turns: [
			"[SPLATES TASK retry-413]\n\nIt waits on my review; show it to me.",
			"Why stop on a 413 only, and not on every 4xx?",
		],
		setup: `splates add retry-413 --task 1 && cd "$(splates path retry-413)" && sed -i.bak 's/if (status < 400) return;/if (status < 400) return;\\n\\t\\tif (status === 413) {\\n\\t\\t\\ttell("the file is too big to upload");\\n\\t\\t\\treturn;\\n\\t\\t}/' src/upload.ts && rm src/upload.ts.bak && git commit -qam "Stop retrying an upload refused as too big" && cat > SPLATES.md <<'EOF'
# retry-413

## Goal

Stop retrying an upload the server refused as too big (413), and tell the user why.

## Next

- [x] stop retrying on 413
- [x] tell the user the file is too big

## Notes

Review: requested
EOF
splates escalate --review "the message a too-big upload shows"`,
		sections: [...CORE, "Merge or review", "Demos"],
		checks: [
			{
				id: "card-again",
				rule: "Ends a reply to a waiting review with the whole review report",
				judge: ({ log }) => {
					const reply = lastSaid(turnsOf(log.transcript.beats)[1] ?? []);
					const titled = /^## 🔍 Ready to merge retry-413 onto main\s*$/m.test(
						reply,
					);
					const ended = reply.endsWith('Reply "merge", or say what to change.');
					return [
						{
							ok: titled && ended,
							why: titled
								? ended
									? "the whole report"
									: "a title without its last line"
								: ended
									? "the last line alone"
									: "no review",
						},
					];
				},
			},
			{
				id: "not-merged",
				rule: "Leaves a review it was asked about unmerged",
				judge: ({ log }) => {
					const merged = splatesRuns(log.transcript.beats).some(
						(run) => run.verb === "merge",
					);
					return [{ ok: !merged, why: merged ? "merged" : "waited" }];
				},
			},
		],
		rubric: [],
	},
	UNTRIAGED,
];

/** A task's heading in a reply, as one proposed. */
const TASK_HEADING = /^### 📝 .+ \[#\d+\]\s*$/m;

/** Whether `splates add` words take queued task `id`. */
function takes(args: string[], id: string): boolean {
	return args[args.indexOf("--task") + 1] === id && args.includes("--task");
}
