import { STARTS } from "./checks";
import { SEEDED } from "./fixture";
import { LANE, PARALLEL, SAME_FILES, UNTRIAGED } from "./lanes";
import {
	arborRuns,
	lastSaid,
	openQuestions,
	section,
	turnsOf,
} from "./reading";
import { CHECK_IN, CHECKPOINT } from "./resumed";
import { CORE, type Scenario } from "./scenario";

export const SCENARIOS: readonly Scenario[] = [
	{
		id: "todo",
		turns: ["[ARBOR TODO #1]"],
		sections: [
			...CORE,
			"Todos",
			"The next todo",
			"Proposing a todo",
			"ARBOR.md",
			"Committing",
			"Merge or review",
			"Asking as you go",
		],
		checks: [
			STARTS,
			{
				id: "took-todo",
				rule: "Reads the todo, then adds a task taking it",
				judge: ({ log }) => {
					const runs = arborRuns(log.transcript.beats);
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
			"Asking as you go",
			"Keeping Blocked current",
			"Escalation",
			"ARBOR.md",
		],
		checks: [
			STARTS,
			{
				id: "recorded",
				rule: "Writes down at least two calls, as assumptions or questions",
				judge: ({ end }) => {
					// Kept in a task's ARBOR.md while it is open, in its commit once it lands.
					const open = end.tasks.reduce(
						(sum, task) =>
							sum +
							numbered(section(task.plan ?? "", "Assumptions")) +
							numbered(section(task.plan ?? "", "Blocked")),
						0,
					);
					const landed = end.main
						.slice(0, -SEEDED)
						.reduce(
							(sum, message) =>
								sum +
								(message.split(/^Assumed:$/m)[1] ?? "")
									.split("\n")
									.filter((line) => line.startsWith("- ")).length,
							0,
						);
					return [
						{
							ok: open + landed >= 2,
							why: `${open} in ARBOR.md, ${landed} assumed in commits`,
						},
					];
				},
			},
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
			"calls-right: the calls written down cover what the request leaves open, such as the cap's number and what happens once it is reached, and each sits where the skill puts it: an assumption when it can be undone and has a clear pick, a question under `## Blocked` when it is hard to undo, outward-facing or a close call",
		],
	},
	LANE,
	PARALLEL,
	SAME_FILES,
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
			"Proposing a todo",
		],
		checks: [
			{
				id: "no-task",
				rule: "Adds no task when no code is asked for",
				judge: ({ log }) => {
					const added = arborRuns(log.transcript.beats).filter(
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
					const runs = arborRuns(log.transcript.beats);
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
			"[ARBOR TODO #1]\n\nHand the tests for this to a subagent while you write the fix.",
		],
		sections: [
			...CORE,
			"Handing out part of your task",
			"Committing",
			"Asking as you go",
		],
		checks: [
			STARTS,
			{
				id: "part-added",
				rule: "Adds the part on its own task's branch",
				judge: ({ log }) => {
					const part = arborRuns(log.transcript.beats).find(
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
			"subagent-brief: the subagent's prompt told it to `arbor claim <part>` and work only in that worktree; not to escalate, report to the user, or take todos; to make each unsettled call itself and list in its reply what it chose and what else it could have done, never under `## Blocked`; and to squash and `arbor merge` the part",
			"calls-recorded: each call the subagent listed was written by the parent under its own `## Assumptions` or `## Blocked` (n/a when it listed none)",
		],
	},
	{
		id: "system",
		turns: [
			"Make #retries back off exponentially between attempts.\n\n#retries: no system answers to this name.",
		],
		sections: [...CORE, "Systems", "Offering a system", "Asking as you go"],
		checks: [
			STARTS,
			{
				id: "no-config",
				rule: "Leaves arbor.systems.ts alone until the user answers",
				judge: ({ end }) => [
					{
						ok: !end.systems,
						why: end.systems ? "wrote arbor.systems.ts" : "left it",
					},
				],
			},
		],
		rubric: [
			"offer: the agent wrote a numbered question under `## Blocked` offering to name the retry code as an arbor system, recommending the name the code already goes by (such as `#upload`, for `src/upload*`) over `#retries`, with choices including adding `#retries` as an alias or leaving it unnamed, one marked `(chosen)`, and every system name and alias in it written as `#name`",
		],
	},
	CHECKPOINT,
	CHECK_IN,
	{
		id: "review-again",
		turns: [
			"[ARBOR TASK retry-413]\n\nIt waits on my review; show it to me.",
			"Why stop on a 413 only, and not on every 4xx?",
		],
		setup: `arbor add retry-413 --todo 1 && cd "$(arbor path retry-413)" && sed -i.bak 's/if (status < 400) return;/if (status < 400) return;\\n\\t\\tif (status === 413) {\\n\\t\\t\\ttell("the file is too big to upload");\\n\\t\\t\\treturn;\\n\\t\\t}/' src/upload.ts && rm src/upload.ts.bak && git commit -qam "Stop retrying an upload refused as too big" && cat > ARBOR.md <<'EOF'
# retry-413

## Goal

Stop retrying an upload the server refused as too big (413), and tell the user why.

## Done

- [x] stop retrying on 413
- [x] tell the user the file is too big

## Notes

Review: requested
EOF
arbor escalate --review "the message a too-big upload shows"`,
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
					const merged = arborRuns(log.transcript.beats).some(
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

/** How many numbered items, questions or assumptions, a section of ARBOR.md holds. */
function numbered(text: string): number {
	return text.split("\n").filter((line) => /^- \[[ x]\] \d+\. /.test(line))
		.length;
}

/** A todo's heading in a reply, as one proposed. */
const TODO_HEADING = /^### 📝 .+ \[#\d+\]\s*$/m;

/** Whether `arbor add` words take todo `id`. */
function takes(args: string[], id: string): boolean {
	return args[args.indexOf("--todo") + 1] === id && args.includes("--todo");
}
