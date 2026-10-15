import { type EvalCheck, STARTS } from "./checks";
import {
	arborRuns,
	lastSaid,
	openQuestions,
	section,
	turnsOf,
} from "./reading";

/**
 * One situation the skill has to handle, run from a fresh fixture: the
 * prompts it is given, the skill sections it exercises, which pick it for a
 * change, and how it is graded, by code wherever a program can tell and by
 * a model only for what takes judgment.
 */
export interface Scenario {
	id: string;
	/** Each turn's prompt; a later turn resumes the session of the first. */
	turns: string[];
	/** Shell run in the repository after the todos are seeded. */
	setup?: string;
	/** Headings of the skill sections it exercises, wherever they live; a change to one runs it. */
	sections: string[];
	checks: EvalCheck[];
	/** What a model grades, each `<id>: <what passes>`. */
	rubric: string[];
}

/** What a model grades in every scenario. */
export const COMMON_RUBRIC = [
	"decisions: every call the request did not settle (a wording, a default, a number, one reading of an ambiguous ask) was written down in ARBOR.md, numbered: under `## Assumptions` when it can be undone and has a clear pick, under `## Blocked` as a question when it is hard to undo, outward-facing or a close call, each with `- (a)` choices and the one taken marked `(chosen)`; fail when a call was made silently or asked only in prose (n/a when no task was added or there were no such calls)",
];

/** Sections every scenario leans on, beyond its own. */
const CORE = ["Using arbor", "Workflow", "Saying what you added", "Reporting"];

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
	{
		id: "lane",
		turns: ["[ARBOR LANE 1]"],
		sections: [
			...CORE,
			"Working a lane",
			"Relaying for a lane's agents",
			"Handing out part of your task",
			"Links",
		],
		checks: [
			{
				id: "started-card",
				rule: "Says it started the lane before handing anything out",
				judge: ({ log }) => {
					const beats = log.transcript.beats;
					const first =
						arborRuns(beats).find((run) => run.verb === "add")?.at ??
						beats.length;
					const ok = beats
						.slice(0, first)
						.some(
							(beat) =>
								beat.kind === "say" &&
								beat.text.trim().startsWith("## 🌱 Started lanes"),
						);
					return [
						{
							ok,
							why: ok
								? "Started card first"
								: "no Started card before the first add",
						},
					];
				},
			},
			{
				id: "in-order",
				rule: "Reads the lane, then hands out #1 and #3 in order, never #2",
				judge: ({ log }) => {
					const runs = arborRuns(log.transcript.beats);
					const show = runs.findIndex(
						(run) => run.verb === "lane" && run.args[0] === "show",
					);
					const taken = runs
						.filter((run) => run.verb === "add")
						.map((run) => run.args[run.args.indexOf("--todo") + 1]);
					const first = runs.findIndex((run) => run.verb === "add");
					const ok = show !== -1 && show < first && taken.join(",") === "1,3";
					return [
						{
							ok,
							why: `lane show ${show === -1 ? "never" : "ran"}; handed out ${taken.join(", ") || "nothing"}`,
						},
					];
				},
			},
			{
				id: "lane-done",
				rule: "Lands both todos and ends on a Finished lanes report",
				judge: ({ log, end }) => {
					const landed = end.main.length - SEEDED;
					const finished = lastSaid(log.transcript.beats).startsWith(
						"## 🏁 Finished lanes",
					);
					return [
						{
							ok: landed === 2 && finished,
							why: `${landed} landed; ${finished ? "Finished report" : "no Finished report"}`,
						},
					];
				},
			},
		],
		rubric: [],
	},
	{
		id: "defer",
		turns: [
			"Note for later, no code now: uploads should show a progress bar. It's a fast follow, and it builds on the 413 fix in #1, which has to land first.",
		],
		sections: [
			...CORE,
			"Todos",
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
				id: "proposed",
				rule: "Heads the new todo with its subject as added",
				judge: ({ log, end }) => {
					const todo = end.todos.find((each) => each.id === 4);
					const subject = String(todo?.subject ?? "");
					const ok =
						todo !== undefined &&
						!subject.includes("📝") &&
						lastSaid(log.transcript.beats).includes(`### 📝 ${subject} [#4]`);
					return [
						{
							ok,
							why: ok ? "proposed" : `no "### 📝 ${subject} [#4]" heading`,
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
		sections: [...CORE, "Systems", "Asking as you go"],
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
			"offer: the agent wrote a numbered question under `## Blocked` offering to name the retry code as a system, recommending the name the code already goes by (such as `upload`, for `src/upload*`) over `retries`, with choices including adding `retries` as an alias or leaving it unnamed, one marked `(chosen)`",
		],
	},
	{
		id: "checkpoint",
		turns: [
			"[ARBOR TASK retry-413]\n\nPick it up and stop before the first code change; say in one line where it stands.",
			"[ARBOR CHECKPOINT]",
		],
		setup: `arbor add retry-413 --todo 1 && cat > "$(arbor path retry-413)/ARBOR.md" <<'EOF'
# retry-413

## Goal

Stop retrying an upload the server refused as too big (413), and tell the user why.

## Done

- [x] read src/upload.ts

## Next

- [ ] stop retrying on 413
- [ ] tell the user the file is too big
- [ ] test both

## Notes
EOF`,
		sections: ["Using arbor", "Workflow", "Checkpoint", "ARBOR.md"],
		checks: [
			{
				id: "claimed",
				rule: "Claims the task and reads its ARBOR.md",
				judge: ({ log }) => {
					const [first = []] = turnsOf(log.transcript.beats);
					const claimed = arborRuns(first).some(
						(run) => run.verb === "claim" && run.args[0] === "retry-413",
					);
					const read =
						log.tools.some(
							(tool) =>
								tool.turn === 1 &&
								JSON.stringify(tool.input).includes("ARBOR.md"),
						) || arborRuns(first).some((run) => run.verb === "show");
					return [
						{
							ok: claimed && read,
							why: `${claimed ? "claimed" : "never claimed"}; ${read ? "read ARBOR.md" : "never read ARBOR.md"}`,
						},
					];
				},
			},
			{
				id: "stopped",
				rule: "Starts no new work on a checkpoint",
				judge: ({ log }) => {
					const second = turnsOf(log.transcript.beats)[1] ?? [];
					const edited = second.some(
						(beat) =>
							(beat.kind === "edit" &&
								beat.paths.some((path) => !path.endsWith("ARBOR.md"))) ||
							(beat.kind === "run" &&
								/src\/\S*\.ts/.test(beat.command) &&
								/(>|\bsed -i|\.write)/.test(beat.command)),
					);
					const merged = arborRuns(second).some((run) => run.verb === "merge");
					return [
						{
							ok: !edited && !merged,
							why: edited ? "edited code" : merged ? "merged" : "stopped",
						},
					];
				},
			},
			{
				id: "noted",
				rule: "Leaves notes in ARBOR.md on where it stopped",
				judge: ({ end }) => {
					const plan =
						end.tasks.find((task) => task.task === "retry-413")?.plan ?? "";
					const ok = section(plan, "Notes").trim() !== "";
					return [{ ok, why: ok ? "notes written" : "Notes left empty" }];
				},
			},
			{
				id: "one-line",
				rule: "Replies to a checkpoint in one line",
				judge: ({ log }) => {
					const reply = lastSaid(turnsOf(log.transcript.beats)[1] ?? []);
					const lines = reply
						.split("\n")
						.filter((line) => line.trim() !== "").length;
					return [{ ok: lines === 1, why: `${lines} lines` }];
				},
			},
		],
		rubric: [
			"notes-say-where: in turn 2 the `## Notes` of ARBOR.md say what the agent was doing when stopped and what comes next, and `## Done` and `## Next` match where the work stands",
		],
	},
];

/** The commits on main before the agent starts. */
const SEEDED = 2;

/** How many numbered items, questions or assumptions, a section of ARBOR.md holds. */
function numbered(text: string): number {
	return text.split("\n").filter((line) => /^- \[[ x]\] \d+\. /.test(line))
		.length;
}

/** Whether `arbor add` words take todo `id`. */
function takes(args: string[], id: string): boolean {
	return args[args.indexOf("--todo") + 1] === id && args.includes("--todo");
}
