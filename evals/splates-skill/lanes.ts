import type { Beat } from "@stringsync/splates-server/stats";
import type { EvalCheck } from "./checks";
import { type EndRepo, SEEDED } from "./fixture";
import { lastSaid, splatesRuns, touchesCode, turnsOf } from "./reading";
import { CORE, type Scenario } from "./scenario";

// The scenarios that make the agent a lane's orchestrator. Run as an agent
// `splates server` started, it plans the lane and sets it running: it links
// what must wait, names a model on each todo, runs `splates lane run`, and
// hands out and does none itself, never waiting on the agents the lane
// starts. It acts again when splates wakes it: a todo come into the lane, an
// agent stuck, a resume, a change of course. Without `splates server`, nothing
// runs the lane, so it lands it through its own subagents instead.

/** The skill sections every lane scenario leans on, beyond CORE. */
const LANES = ["Working a lane", "Planning a lane", "Reporting on lanes"];

/** Whether `run` is `splates lane run <lane>`. */
function runsLane(
	run: { verb: string; args: string[] },
	lane?: string,
): boolean {
	return (
		run.verb === "lane" &&
		run.args[0] === "run" &&
		(lane === undefined || run.args[1] === lane)
	);
}

/** Says it started its lanes before setting any running. */
const STARTED: EvalCheck = {
	id: "started-card",
	rule: "Says it started the lane before setting it running",
	judge: ({ log }) => {
		const beats = log.transcript.beats;
		const first =
			splatesRuns(beats).find((run) => runsLane(run))?.at ?? beats.length;
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
				why: ok ? "Started card first" : "no Started card before lane run",
			},
		];
	},
};

/** Sets lane `lane` running. */
function runs(lane: string): EvalCheck {
	return {
		id: "runs",
		rule: `Sets lane ${lane} running with splates lane run`,
		judge: ({ log }) => {
			const ok = splatesRuns(log.transcript.beats).some((run) =>
				runsLane(run, lane),
			);
			return [{ ok, why: ok ? `ran lane ${lane}` : `never ran lane ${lane}` }];
		},
	};
}

/** The todo `id` as the repository ends, if still listed. */
function todoAt(
	end: EndRepo,
	id: number,
): { blockedBy?: number[]; assignee?: { agent?: string } } | undefined {
	return end.todos.find((todo) => todo.id === id) as
		| { blockedBy?: number[]; assignee?: { agent?: string } }
		| undefined;
}

/** Leaves each of `ids` naming an agent, so the lane starts it. */
function names(...ids: number[]): EvalCheck {
	return {
		id: "names-models",
		rule: `Names an agent and model on ${ids.map((id) => `#${id}`).join(" and ")}`,
		judge: ({ end }) => {
			const bare = ids.filter(
				(id) => todoAt(end, id)?.assignee?.agent === undefined,
			);
			return [
				{
					ok: bare.length === 0,
					why:
						bare.length === 0
							? "named each"
							: `named none on ${bare.map((id) => `#${id}`).join(", ")}`,
				},
			];
		},
	};
}

/** Ends with todo `id` blocked by `by`, or, when `linked` is false, not. */
function links(
	id: number,
	by: number,
	linked: boolean,
	why: string,
): EvalCheck {
	return {
		id: linked ? "links" : "leaves-unlinked",
		rule: `${linked ? "Links" : "Leaves"} #${id} ${linked ? "blocked by" : "unblocked by"} #${by}: ${why}`,
		judge: ({ end }) => {
			const is = todoAt(end, id)?.blockedBy?.includes(by) ?? false;
			return [
				{
					ok: is === linked,
					why: is ? `#${id} waits on #${by}` : `#${id} waits on no #${by}`,
				},
			];
		},
	};
}

/** The todos `beats` hand out, in order, by `splates add --todo`. */
function handedOut(beats: Beat[]): string[] {
	return splatesRuns(beats)
		.filter((run) => run.verb === "add" && run.args.includes("--todo"))
		.map((run) => run.args[run.args.indexOf("--todo") + 1] ?? "");
}

/**
 * Hands out no todo and does none itself: the lane starts each, so it takes
 * none with `splates add --todo`, writes no code and runs no subagent.
 */
const HANDS_OFF: EvalCheck = {
	id: "hands-off",
	rule: "Hands out no todo with splates add, writing no code and running no subagent",
	judge: ({ log }) => {
		const beats = log.transcript.beats;
		const taken = handedOut(beats);
		const wrote = beats.some(touchesCode);
		const spawned = log.tools.some(
			(tool) => tool.name === "Agent" || tool.name === "Task",
		);
		return [
			{
				ok: taken.length === 0 && !wrote && !spawned,
				why:
					taken.length > 0
						? `handed out ${taken.join(", ")}`
						: wrote
							? "wrote code"
							: spawned
								? "ran a subagent"
								: "left it to the lane",
			},
		];
	},
};

/** Never waits on the lane's agents: splates wakes it. */
const NEVER_WAITS: EvalCheck = {
	id: "never-waits",
	rule: "Never waits, sleeps or polls for the agents the lane starts",
	judge: ({ log }) => {
		const beats = log.transcript.beats;
		const waited = splatesRuns(beats).some(
			(run) =>
				run.verb === "wait" || (run.verb === "todo" && run.args[0] === "wait"),
		);
		const slept = beats.some(
			(beat) => beat.kind === "run" && /\bsleep\b/.test(beat.command),
		);
		return [
			{
				ok: !waited && !slept,
				why: waited ? "ran splates wait" : slept ? "slept" : "never waited",
			},
		];
	},
};

/** Ends its turn on a working report, with the lane still running. */
const WORKING: EvalCheck = {
	id: "working-report",
	rule: "Ends on a Working lanes report",
	judge: ({ log }) => {
		const ok = lastSaid(log.transcript.beats).startsWith("## ⏳ Working lanes");
		return [{ ok, why: ok ? "Working report" : "no Working report last" }];
	},
};

/** What every scenario run as `splates server`'s agent checks, beyond its own. */
const AS_DEV = [HANDS_OFF, NEVER_WAITS, WORKING];

/** #3, unlinked from #1, in a file of its own. */
const APART =
	"splates todo update 3 --remove-blocked-by 1 --subject 'Describe a refused upload in words' 'Add `describe(status)` in a new `src/describe.ts` that turns a refusal status into a sentence. It does not touch `src/upload.ts`.'";

/** Plans the lane: names a model on #1 and #3, keeps #3 waiting on #1, and runs it, never touching untriaged #2. */
export const LANE: Scenario = {
	id: "lane",
	turns: ["[SPLATES LANE 1]"],
	dev: true,
	sections: [...CORE, ...LANES, "Links"],
	checks: [
		STARTED,
		{
			id: "reads-first",
			rule: "Reads the lane before setting it running",
			judge: ({ log }) => {
				const all = splatesRuns(log.transcript.beats);
				const show = all.findIndex(
					(run) => run.verb === "lane" && run.args[0] === "show",
				);
				const first = all.findIndex((run) => runsLane(run));
				const ok = show !== -1 && (first === -1 || show < first);
				return [
					{ ok, why: show === -1 ? "never ran lane show" : "lane show first" },
				];
			},
		},
		names(1, 3),
		links(3, 1, true, "it builds on #1"),
		runs("1"),
		...AS_DEV,
	],
	rubric: [
		"holds-blocked: the Working report says #3 waits on #1, rather than starting it or doing it",
	],
};

/** Leaves a lane's two todos on separate files unlinked, so both start at once. */
export const PARALLEL: Scenario = {
	id: "lane-parallel",
	turns: ["[SPLATES LANE 1]"],
	setup: APART,
	dev: true,
	sections: [...CORE, ...LANES],
	checks: [
		STARTED,
		names(1, 3),
		links(3, 1, false, "they share no file and #3 needs nothing of #1"),
		runs("1"),
		...AS_DEV,
	],
	rubric: [],
};

/** Links a lane's unlinked todo that changes the same file as the one above it. */
export const SAME_FILES: Scenario = {
	id: "lane-same-files",
	turns: ["[SPLATES LANE 1]"],
	setup: "splates todo update 3 --remove-blocked-by 1",
	dev: true,
	sections: [...CORE, ...LANES],
	checks: [
		STARTED,
		names(1, 3),
		links(3, 1, true, "both change `src/upload.ts`"),
		runs("1"),
		...AS_DEV,
	],
	rubric: [],
};

/** Todo #1 handed out as retry-413 to an agent `splates server` started, which has yet to land it. */
const HANDED = `splates add retry-413 --todo 1 --agent claude --model sonnet --prompt 'Stop retrying on a 413.' >/dev/null && bun -e '
const path = ".git/splates/tasks/retry-413.json";
const state = await Bun.file(path).json();
const { pending, ...dispatch } = state.dispatch;
await Bun.write(path, JSON.stringify({ ...state, dispatch: { ...dispatch, conversation: "agent-413" } }, null, "\\t"));
'`;

/** Lane 1 planned and running, with #1 and #3 each naming a model. */
const RUNNING =
	"splates todo update 1 --agent claude --model sonnet >/dev/null && splates todo update 3 --agent claude --model sonnet >/dev/null && splates lane run 1 >/dev/null";

/** Plans untriaged #2 in once it comes into the running lane, leaving it to start. */
export const ADDED: Scenario = {
	id: "lane-added",
	turns: ["[SPLATES TODO ADDED #2]"],
	setup: `${RUNNING} && splates todo update 2 --lane 1 >/dev/null`,
	dev: true,
	sections: [...CORE, ...LANES, "What wakes you"],
	checks: [
		names(2),
		links(2, 1, false, "the export menu shares no file with the 413 fix"),
		...AS_DEV,
	],
	rubric: [],
};

/**
 * Asks the person what becomes of retry-413, which splates already told to
 * carry on once, rather than telling it again or taking its task over.
 */
export const IDLE: Scenario = {
	id: "lane-idle",
	turns: ["[SPLATES IDLE retry-413]"],
	setup: `${HANDED} && ${RUNNING}`,
	dev: true,
	sections: [...CORE, ...LANES, "What wakes you"],
	checks: [
		{
			id: "asks",
			rule: "Asks the person what becomes of retry-413, as a numbered question, and never claims the task",
			judge: ({ log }) => {
				const beats = log.transcript.beats;
				const claimed = splatesRuns(beats).some(
					(run) => run.verb === "claim" && run.args[0] === "retry-413",
				);
				const asked = /^1\. .*\?$/m.test(lastSaid(beats));
				return [
					{
						ok: asked && !claimed,
						why: claimed
							? "claimed retry-413"
							: asked
								? "asked what becomes of it"
								: "asked nothing",
					},
				];
			},
		},
		...AS_DEV,
	],
	rubric: [],
};

/** The pivot the person asks for once the orchestrator resumed. */
const PIVOT =
	"Change of plans: the server will cap upload sizes itself, so drop the 413 work. Stop retry-413 and drop it with todo #1, but keep #3.";

/**
 * Resumes the lane with #1 already out, leaving it to its agent and setting
 * the lane running, then drops it at the person's word: stops its agent
 * first, removes the task and the todo, and keeps #3 for the lane to start.
 */
export const PIVOT_LANE: Scenario = {
	id: "lane-pivot",
	turns: ["[SPLATES LANE 1]", PIVOT],
	setup: HANDED,
	dev: true,
	sections: [...CORE, ...LANES, "What wakes you", "Changing course"],
	checks: [
		{
			id: "resumes",
			rule: "On resuming, reads the lane, sets it running, and hands nothing out",
			judge: ({ log }) => {
				const [first = []] = turnsOf(log.transcript.beats);
				const all = splatesRuns(first);
				const checked = all.some(
					(run) =>
						(run.verb === "show" && run.args[0] === "retry-413") ||
						(run.verb === "lane" && run.args[0] === "show"),
				);
				const ran = all.some((run) => runsLane(run, "1"));
				const taken = handedOut(first);
				return [
					{
						ok: checked && ran && taken.length === 0,
						why: `${checked ? "checked it" : "never checked it"}; ${ran ? "ran the lane" : "never ran the lane"}; handed out ${taken.join(", ") || "nothing"}`,
					},
				];
			},
		},
		{
			id: "stops-then-drops",
			rule: "Stops retry-413's agent with tell --stop before removing the task, then removes todo #1",
			judge: ({ log }) => {
				const all = splatesRuns(turnsOf(log.transcript.beats)[1] ?? []);
				const stop = all.findIndex(
					(run) =>
						run.verb === "tell" &&
						run.args[0] === "retry-413" &&
						run.args.includes("--stop"),
				);
				const remove = all.findIndex(
					(run) => run.verb === "remove" && run.args[0] === "retry-413",
				);
				const dropped = all.some(
					(run) =>
						run.verb === "todo" &&
						run.args[0] === "remove" &&
						run.args.includes("1"),
				);
				const ok = stop !== -1 && remove > stop && dropped;
				return [
					{
						ok,
						why: `${stop === -1 ? "never stopped it" : "stopped it"}; ${remove === -1 ? "never removed it" : remove > stop ? "then removed it" : "removed it first"}; ${dropped ? "dropped #1" : "kept #1"}`,
					},
				];
			},
		},
		{
			id: "keeps-going",
			rule: "Keeps #3 on the list, naming a model on it, for the lane to start",
			judge: ({ end }) => {
				const kept = todoAt(end, 3);
				const named = kept?.assignee?.agent !== undefined;
				return [
					{
						ok: kept !== undefined && named,
						why:
							kept === undefined
								? "dropped #3"
								: named
									? "kept #3, named"
									: "kept #3, naming no agent",
					},
				];
			},
		},
		...AS_DEV,
	],
	rubric: [],
};

/**
 * Without `splates server`, lands a lane's two unlinked todos through subagents
 * of its own, since no agent it names would start.
 */
export const NO_DEV: Scenario = {
	id: "lane-no-dev",
	turns: ["[SPLATES LANE 1]"],
	setup: APART,
	sections: [...CORE, ...LANES, "Without splates server"],
	checks: [
		STARTED,
		{
			id: "no-agent-flag",
			rule: "Never hands a todo out with --agent, which nothing would start",
			judge: ({ log }) => {
				const flagged = splatesRuns(log.transcript.beats).some(
					(run) => run.verb === "add" && run.args.includes("--agent"),
				);
				return [
					{
						ok: !flagged,
						why: flagged ? "used --agent" : "never used --agent",
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
	rubric: [
		"own-agents: #1 and #3 went to subagents of its own harness, each told to claim its task, or it did one itself saying why, since nothing starts an agent without splates server",
	],
};

/** Places untriaged #2 in a lane of its own, then plans and runs only that lane. */
export const UNTRIAGED: Scenario = {
	id: "untriaged",
	turns: ["[SPLATES LANE untriaged]"],
	dev: true,
	sections: [
		...CORE,
		...LANES,
		"Working the untriaged lane",
		"Linking, placing and ordering todos",
		"Lanes",
	],
	checks: [
		STARTED,
		{
			id: "placed-first",
			rule: "Places #2 in a lane of its own before setting any running",
			judge: ({ log }) => {
				const all = splatesRuns(log.transcript.beats);
				const placed = all.findIndex(
					(run) =>
						run.verb === "todo" &&
						run.args[0] === "update" &&
						run.args[1] === "2" &&
						run.args.includes("--lane"),
				);
				const lane =
					all[placed]?.args[(all[placed]?.args.indexOf("--lane") ?? 0) + 1];
				const first = all.findIndex((run) => runsLane(run));
				const ok =
					placed !== -1 && lane !== "1" && (first === -1 || placed < first);
				return [
					{
						ok,
						why:
							placed === -1
								? "never placed #2"
								: lane === "1"
									? "placed #2 in Upload errors"
									: ok
										? `placed #2 in lane ${lane} first`
										: "set a lane running before placing #2",
					},
				];
			},
		},
		{
			id: "own-lanes",
			rule: "Sets running the lane #2 went to, and never lane 1, which it was not sent",
			judge: ({ log }) => {
				const all = splatesRuns(log.transcript.beats);
				const ran = all
					.filter((run) => runsLane(run))
					.map((run) => run.args[1]);
				const ok = ran.length > 0 && !ran.includes("1");
				return [
					{
						ok,
						why: `ran ${ran.map((lane) => `lane ${lane}`).join(", ") || "no lane"}`,
					},
				];
			},
		},
		names(2),
		...AS_DEV,
	],
	rubric: [],
};
