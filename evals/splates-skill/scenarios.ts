import { STARTS } from "./checks";
import { SEEDED } from "./fixture";
import {
	IDLE,
	LANE,
	NO_DEV,
	PARALLEL,
	PIVOT_LANE,
	REPORT,
	SAME_FILES,
	UNTRIAGED,
} from "./lanes";
import { lastSaid, openQuestions, splatesRuns, turnsOf } from "./reading";
import { CHECKPOINT } from "./resumed";
import { CORE, type Scenario } from "./scenario";

export const SCENARIOS: readonly Scenario[] = [
	{
		id: "todo",
		turns: ["[SPLATES TODO #1]"],
		sections: [
			...CORE,
			"Todos",
			"SPLATES.md",
			"Committing",
			"Merge or review",
			"Questions",
		],
		checks: [
			STARTS,
			{
				id: "took-todo",
				rule: "Reads the todo, then adds a task taking it",
				judge: ({ log }) => {
					const runs = splatesRuns(log.transcript.beats);
					const show = runs.findIndex(
						(run) =>
							run.verb === "todo" &&
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
									: "did not add it with --todo 1",
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
			"calls-right: the agent settled what the request leaves open, such as the cap's number and what happens once it is reached, and handled each call where the skill puts it: made itself and noted under `## Notes` when one commit's revert would undo it, a close call included, a question under `## Blocked` when undoing it reaches past the repo's code or a wrong guess would cost much rework",
		],
	},
	LANE,
	PARALLEL,
	SAME_FILES,
	REPORT,
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
			"Todos",
			"Linking, placing and ordering todos",
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
				rule: "Adds the todo blocked by #1, in lane 1, near the top after reading the list",
				judge: ({ log, end }) => {
					const todo = end.todos.find((each) => each.id === 4);
					if (todo === undefined) {
						return [{ ok: false, why: "no todo added" }];
					}
					const runs = splatesRuns(log.transcript.beats);
					const read = runs.findIndex(
						(run) => run.verb === "todo" && run.args[0] === "list",
					);
					const placed = runs.findLastIndex(
						(run) =>
							run.verb === "todo" &&
							["add", "update"].includes(run.args[0] ?? ""),
					);
					const problems = [
						...((todo.blockedBy as number[]).includes(1)
							? []
							: ["not blocked by #1"]),
						...(todo.lane === 1 ? [] : [`in lane ${todo.lane}`]),
						...((todo.position as number) <= 2
							? []
							: [`at position ${todo.position}`]),
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
				rule: "Keeps the new todo's subject plain, and leaves heading it to its event line",
				judge: ({ log, end }) => {
					const todo = end.todos.find((each) => each.id === 4);
					const subject = String(todo?.subject ?? "");
					const headed = TODO_HEADING.test(lastSaid(log.transcript.beats));
					const problems = [
						...(todo === undefined ? ["no todo added"] : []),
						...(subject.includes("📝") ? ["📝 in the subject"] : []),
						...(headed ? ["headed the added todo"] : []),
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
			"[SPLATES TODO #1]\n\nHand the tests for this to a subagent while you write the fix.",
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
			"subagent-brief: the subagent's prompt told it to `splates claim <part>` and work only in that worktree; not to escalate, report to the user, or take todos; to make each unsettled call itself and list in its reply what it chose and what else it could have done, never under `## Blocked`; and to squash and `splates merge` the part",
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
		setup: `splates add retry-413 --todo 1 && cd "$(splates path retry-413)" && sed -i.bak 's/if (status < 400) return;/if (status < 400) return;\\n\\t\\tif (status === 413) {\\n\\t\\t\\ttell("the file is too big to upload");\\n\\t\\t\\treturn;\\n\\t\\t}/' src/upload.ts && rm src/upload.ts.bak && git commit -qam "Stop retrying an upload refused as too big" && cat > SPLATES.md <<'EOF'
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

/** A todo's heading in a reply, as one proposed. */
const TODO_HEADING = /^### 📝 .+ \[#\d+\]\s*$/m;

/** Whether `splates add` words take todo `id`. */
function takes(args: string[], id: string): boolean {
	return args[args.indexOf("--todo") + 1] === id && args.includes("--todo");
}
