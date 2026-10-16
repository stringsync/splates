import type { Beat } from "@webappwiz/arbor/skill-checks";
import type { EvalCheck } from "./checks";
import { SEEDED } from "./fixture";
import { arborRuns, lastSaid, touchesCode, turnsOf } from "./reading";
import { CORE, type Scenario } from "./scenario";

// The scenarios that make the agent a lane's orchestrator. Run as an agent
// `arbor dev` started, it hands each todo to an agent of its own and does
// none itself, never waits on them, and acts when arbor wakes it: a report,
// an agent gone idle, a resume, a change of course. Without `arbor dev`,
// nothing starts those agents, so it lands the lane through its own
// subagents instead.

/** The skill sections every lane scenario leans on, beyond CORE. */
const LANES = ["Working a lane", "Handing out", "Reporting on lanes"];

/** Says it started its lanes before handing anything out. */
const STARTED: EvalCheck = {
	id: "started-card",
	rule: "Says it started the lane before handing anything out",
	judge: ({ log }) => {
		const beats = log.transcript.beats;
		const first =
			arborRuns(beats).find((run) => run.verb === "add")?.at ?? beats.length;
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
				why: ok ? "Started card first" : "no Started card before the first add",
			},
		];
	},
};

/** The todos `beats` hand out, in order, by `arbor add --todo`. */
function handedOut(beats: Beat[]): string[] {
	return arborRuns(beats)
		.filter((run) => run.verb === "add" && run.args.includes("--todo"))
		.map((run) => run.args[run.args.indexOf("--todo") + 1] ?? "");
}

/** Hands out exactly `todos`, in any order. */
function handsOut(...todos: string[]): EvalCheck {
	return {
		id: "hands-out",
		rule:
			todos.length === 0
				? "Hands out no todo"
				: `Hands out ${todos.map((id) => `#${id}`).join(" and ")}, and nothing else`,
		judge: ({ log }) => {
			const taken = handedOut(log.transcript.beats);
			const ok = taken.toSorted().join(",") === todos.toSorted().join(",");
			return [{ ok, why: `handed out ${taken.join(", ") || "nothing"}` }];
		},
	};
}

/**
 * Does no todo itself: every one it hands out goes to an agent `arbor dev`
 * starts, and it neither writes code nor runs a subagent of its own.
 */
const HANDS_OFF: EvalCheck = {
	id: "hands-off",
	rule: "Hands each todo to an agent with --agent, writing no code and running no subagent",
	judge: ({ log }) => {
		const beats = log.transcript.beats;
		const bare = arborRuns(beats).some(
			(run) =>
				run.verb === "add" &&
				run.args.includes("--todo") &&
				!run.args.includes("--agent"),
		);
		const wrote = beats.some(touchesCode);
		const spawned = log.tools.some(
			(tool) => tool.name === "Agent" || tool.name === "Task",
		);
		return [
			{
				ok: !bare && !wrote && !spawned,
				why: bare
					? "took a todo without --agent"
					: wrote
						? "wrote code"
						: spawned
							? "ran a subagent"
							: "handed everything off",
			},
		];
	},
};

/** Never waits on its agents: arbor wakes it. */
const NEVER_WAITS: EvalCheck = {
	id: "never-waits",
	rule: "Never waits, sleeps or polls for the agents it handed todos to",
	judge: ({ log }) => {
		const beats = log.transcript.beats;
		const waited = arborRuns(beats).some(
			(run) =>
				run.verb === "wait" || (run.verb === "todo" && run.args[0] === "wait"),
		);
		const slept = beats.some(
			(beat) => beat.kind === "run" && /\bsleep\b/.test(beat.command),
		);
		return [
			{
				ok: !waited && !slept,
				why: waited ? "ran arbor wait" : slept ? "slept" : "never waited",
			},
		];
	},
};

/** Ends its turn on a working report, with tasks still out. */
const WORKING: EvalCheck = {
	id: "working-report",
	rule: "Ends on a Working lanes report",
	judge: ({ log }) => {
		const ok = lastSaid(log.transcript.beats).startsWith("## ⏳ Working lanes");
		return [{ ok, why: ok ? "Working report" : "no Working report last" }];
	},
};

/** What every scenario run as `arbor dev`'s agent checks, beyond its own. */
const AS_DEV = [HANDS_OFF, NEVER_WAITS, WORKING];

/** #3, unlinked from #1, in a file of its own. */
const APART =
	"arbor todo update 3 --remove-blocked-by 1 --subject 'Describe a refused upload in words' 'Add `describe(status)` in a new `src/describe.ts` that turns a refusal status into a sentence. It does not touch `src/upload.ts`.'";

/** Works the lane: hands out #1, holding #3, which builds on it, and never untriaged #2. */
export const LANE: Scenario = {
	id: "lane",
	turns: ["[ARBOR LANE 1]"],
	dev: true,
	sections: [...CORE, ...LANES, "Links"],
	checks: [
		STARTED,
		{
			id: "reads-first",
			rule: "Reads the lane before handing anything out",
			judge: ({ log }) => {
				const runs = arborRuns(log.transcript.beats);
				const show = runs.findIndex(
					(run) => run.verb === "lane" && run.args[0] === "show",
				);
				const first = runs.findIndex((run) => run.verb === "add");
				const ok = show !== -1 && (first === -1 || show < first);
				return [
					{ ok, why: show === -1 ? "never ran lane show" : "lane show first" },
				];
			},
		},
		handsOut("1"),
		...AS_DEV,
	],
	rubric: [
		"holds-blocked: the Working report says #3 waits on #1, rather than handing it out or doing it",
	],
};

/** Hands out a lane's two unlinked todos on separate files at once. */
export const PARALLEL: Scenario = {
	id: "lane-parallel",
	turns: ["[ARBOR LANE 1]"],
	setup: APART,
	dev: true,
	sections: [...CORE, ...LANES],
	checks: [STARTED, handsOut("1", "3"), ...AS_DEV],
	rubric: [],
};

/** Holds back a lane's unlinked todo that changes the same file as one out. */
export const SAME_FILES: Scenario = {
	id: "lane-same-files",
	turns: ["[ARBOR LANE 1]"],
	setup: "arbor todo update 3 --remove-blocked-by 1",
	dev: true,
	sections: [...CORE, ...LANES],
	checks: [STARTED, handsOut("1"), ...AS_DEV],
	rubric: [
		"holds-overlap: #3 is held back, not handed out, since it changes `src/upload.ts` as #1 does, and the Working report says it waits for that",
	],
};

/** Todo #1 handed out as retry-413 to an agent `arbor dev` started, which has yet to land it. */
const HANDED = `arbor add retry-413 --todo 1 --agent claude --model sonnet --prompt 'Stop retrying on a 413.' >/dev/null && bun -e '
const path = ".git/arbor/tasks/retry-413.json";
const state = await Bun.file(path).json();
const { pending, ...dispatch } = state.dispatch;
await Bun.write(path, JSON.stringify({ ...state, dispatch: { ...dispatch, conversation: "agent-413" } }, null, "\\t"));
'`;

/** retry-413, handed out, then merged as its agent would. */
const MERGED = `${HANDED} && cd "$(arbor path retry-413)" && cat > src/upload.ts <<'EOF'
/** Sends a file, retrying until the server accepts it or refuses it as too big. */
export async function upload(
	send: () => Promise<number>,
	tell: (message: string) => void = console.error,
): Promise<void> {
	for (;;) {
		const status = await send();
		if (status < 400) return;
		if (status === 413) {
			tell("the file is too big to upload");
			return;
		}
		tell(\`upload failed with \${status}, retrying\`);
	}
}
EOF
printf '# retry-413\\n\\n## Goal\\n\\nStop retrying on a 413.\\n\\n## Done\\n\\n- [x] stop retrying on 413, telling the user the file is too big\\n' > ARBOR.md && git commit -qam 'Stop retrying an upload the server refused as too big' && arbor claim retry-413 >/dev/null && arbor merge >/dev/null`;

/** Once #1's task merged, hands out #3, which it held back. */
export const REPORT: Scenario = {
	id: "lane-report",
	turns: ["[ARBOR REPORT retry-413]"],
	setup: MERGED,
	dev: true,
	sections: [...CORE, ...LANES, "What wakes you"],
	checks: [handsOut("3"), ...AS_DEV],
	rubric: [
		"passes-on: the --prompt #3 goes out with says what #1 landed that it builds on: `upload` now stops on a 413 and tells the user the file is too big",
	],
};

/** Tells the idle agent on #1 to carry on, rather than taking its task over. */
export const IDLE: Scenario = {
	id: "lane-idle",
	turns: ["[ARBOR IDLE retry-413]"],
	setup: HANDED,
	dev: true,
	sections: [...CORE, ...LANES, "What wakes you"],
	checks: [
		{
			id: "tells",
			rule: "Tells retry-413's agent to carry on, without stopping it, and never claims the task",
			judge: ({ log }) => {
				const runs = arborRuns(log.transcript.beats);
				const told = runs.some(
					(run) =>
						run.verb === "tell" &&
						run.args[0] === "retry-413" &&
						!run.args.includes("--stop"),
				);
				const claimed = runs.some(
					(run) => run.verb === "claim" && run.args[0] === "retry-413",
				);
				return [
					{
						ok: told && !claimed,
						why: claimed
							? "claimed retry-413"
							: told
								? "told it to carry on"
								: "never told it",
					},
				];
			},
		},
		handsOut(),
		...AS_DEV,
	],
	rubric: [],
};

/** The pivot the person asks for once the orchestrator resumed. */
const PIVOT =
	"Change of plans: the server will cap upload sizes itself, so drop the 413 work. Stop retry-413 and drop it with todo #1, but keep #3.";

/**
 * Resumes the lane with #1 already out, leaving it to its agent, then drops
 * it at the person's word: stops its agent first, removes the task and the
 * todo, and hands out #3, which nothing blocks any more.
 */
export const PIVOT_LANE: Scenario = {
	id: "lane-pivot",
	turns: ["[ARBOR LANE 1]", PIVOT],
	setup: HANDED,
	dev: true,
	sections: [...CORE, ...LANES, "What wakes you", "Changing course"],
	checks: [
		{
			id: "resumes",
			rule: "On resuming, checks retry-413 and hands nothing out again",
			judge: ({ log }) => {
				const [first = []] = turnsOf(log.transcript.beats);
				const checked = arborRuns(first).some(
					(run) =>
						(run.verb === "show" && run.args[0] === "retry-413") ||
						(run.verb === "lane" && run.args[0] === "show"),
				);
				const taken = handedOut(first);
				return [
					{
						ok: checked && taken.length === 0,
						why: `${checked ? "checked it" : "never checked it"}; handed out ${taken.join(", ") || "nothing"}`,
					},
				];
			},
		},
		{
			id: "stops-then-drops",
			rule: "Stops retry-413's agent with tell --stop before removing the task, then removes todo #1",
			judge: ({ log }) => {
				const runs = arborRuns(turnsOf(log.transcript.beats)[1] ?? []);
				const stop = runs.findIndex(
					(run) =>
						run.verb === "tell" &&
						run.args[0] === "retry-413" &&
						run.args.includes("--stop"),
				);
				const remove = runs.findIndex(
					(run) => run.verb === "remove" && run.args[0] === "retry-413",
				);
				const dropped = runs.some(
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
			rule: "Hands out #3 once #1 is gone, and keeps it on the list",
			judge: ({ log, end }) => {
				const taken = handedOut(turnsOf(log.transcript.beats)[1] ?? []);
				const kept = end.todos.some((todo) => todo.id === 3);
				return [
					{
						ok: taken.join(",") === "3" && kept,
						why: `handed out ${taken.join(", ") || "nothing"}; ${kept ? "kept #3" : "dropped #3"}`,
					},
				];
			},
		},
		...AS_DEV,
	],
	rubric: [],
};

/**
 * Without `arbor dev`, lands a lane's two unlinked todos through subagents
 * of its own, since no agent it names would start.
 */
export const NO_DEV: Scenario = {
	id: "lane-no-dev",
	turns: ["[ARBOR LANE 1]"],
	setup: APART,
	sections: [...CORE, ...LANES, "Changing course"],
	checks: [
		STARTED,
		{
			id: "no-agent-flag",
			rule: "Never hands a todo out with --agent, which nothing would start",
			judge: ({ log }) => {
				const flagged = arborRuns(log.transcript.beats).some(
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
		"own-agents: #1 and #3 went to subagents of its own harness, each told to claim its task, or it did one itself saying why, since nothing starts an agent without arbor dev",
	],
};

/** Places untriaged #2 in a lane, then works only that lane. */
export const UNTRIAGED: Scenario = {
	id: "untriaged",
	turns: ["[ARBOR LANE untriaged]"],
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
			rule: "Places #2 in a lane of its own before handing anything out",
			judge: ({ log }) => {
				const runs = arborRuns(log.transcript.beats);
				const placed = runs.findIndex(
					(run) =>
						run.verb === "todo" &&
						run.args[0] === "update" &&
						run.args[1] === "2" &&
						run.args.includes("--lane"),
				);
				const lane =
					runs[placed]?.args[(runs[placed]?.args.indexOf("--lane") ?? 0) + 1];
				const first = runs.findIndex((run) => run.verb === "add");
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
										: "handed out a todo before placing #2",
					},
				];
			},
		},
		{ ...handsOut("2"), id: "own-lanes" },
		...AS_DEV,
	],
	rubric: [],
};
