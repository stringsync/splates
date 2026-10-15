import type { EvalCheck } from "./checks";
import { SEEDED } from "./fixture";
import { arborRuns, lastSaid } from "./reading";
import { CORE, type Scenario } from "./scenario";

// The scenarios that make the agent a lane's orchestrator, handing todos to
// agents of its own or doing them itself.

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

/** Works lane 1 down: hands out #1, then #3 once #1 lands, never untriaged #2. */
export const LANE: Scenario = {
	id: "lane",
	turns: ["[ARBOR LANE 1]"],
	sections: [
		...CORE,
		"Working a lane",
		"Doing a todo yourself",
		"Relaying for a lane's agents",
		"Reporting on lanes",
		"Handing out part of your task",
		"Links",
	],
	checks: [
		STARTED,
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
};

/** Hands out the two checks a lane's unlinked todos on separate files at once. */
const BOTH_OUT: EvalCheck = {
	id: "both-out",
	rule: "Hands out #1 and #3 before waiting on either to land",
	judge: ({ log }) => {
		const runs = arborRuns(log.transcript.beats);
		const adds = runs.filter(
			(run) => run.verb === "add" && run.args.includes("--todo"),
		);
		const taken = adds.map((run) => run.args[run.args.indexOf("--todo") + 1]);
		const wait = runs.findIndex(
			(run) =>
				run.verb === "wait" || (run.verb === "todo" && run.args[0] === "wait"),
		);
		const last = adds.at(-1)?.at ?? -1;
		const ok =
			taken.sort().join(",") === "1,3" &&
			(wait === -1 || (runs[wait]?.at ?? 0) > last);
		return [
			{
				ok,
				why: `handed out ${taken.join(", ") || "nothing"}; ${wait === -1 ? "never waited" : "waited"}`,
			},
		];
	},
};

/** Works a lane whose #3 is no longer linked to #1 and touches another file. */
export const PARALLEL: Scenario = {
	id: "lane-parallel",
	turns: ["[ARBOR LANE 1]"],
	setup:
		"arbor todo update 3 --remove-blocked-by 1 --subject 'Describe a refused upload in words' 'Add `describe(status)` in a new `src/describe.ts` that turns a refusal status into a sentence. It does not touch `src/upload.ts`.'",
	sections: [
		...CORE,
		"Working a lane",
		"Doing a todo yourself",
		"Reporting on lanes",
	],
	checks: [STARTED, BOTH_OUT],
	rubric: [
		"parallel: #1 and #3 were both out at once, each as a task of its own or the orchestrator's, since they share no files and nothing links them",
	],
};

/** Works a lane whose #3 is no longer linked to #1 but changes the same file. */
export const SAME_FILES: Scenario = {
	id: "lane-same-files",
	turns: ["[ARBOR LANE 1]"],
	setup: "arbor todo update 3 --remove-blocked-by 1",
	sections: [...CORE, "Working a lane", "Reporting on lanes"],
	checks: [
		STARTED,
		{
			id: "overlap-lands",
			rule: "Lands both todos though #3 had to wait for #1's files",
			judge: ({ end }) => {
				const landed = end.main.length - SEEDED;
				return [{ ok: landed === 2, why: `${landed} landed` }];
			},
		},
	],
	rubric: [
		"waits-for-overlap: #3 was handed out or started only after #1's task landed, since both change `src/upload.ts`, never while #1's task was still out",
	],
};

/** Places untriaged #2 in a lane, then works only that lane. */
export const UNTRIAGED: Scenario = {
	id: "untriaged",
	turns: ["[ARBOR LANE untriaged]"],
	sections: [
		...CORE,
		"Working a lane",
		"Working the untriaged lane",
		"Reporting on lanes",
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
		{
			id: "own-lanes",
			rule: "Hands out only #2, never Upload errors' #1 or #3",
			judge: ({ log }) => {
				const taken = arborRuns(log.transcript.beats)
					.filter((run) => run.verb === "add" && run.args.includes("--todo"))
					.map((run) => run.args[run.args.indexOf("--todo") + 1]);
				const ok = taken.join(",") === "2";
				return [{ ok, why: `handed out ${taken.join(", ") || "nothing"}` }];
			},
		},
		{
			id: "finished",
			rule: "Ends on a Finished lanes report",
			judge: ({ log }) => {
				const ok = lastSaid(log.transcript.beats).startsWith(
					"## 🏁 Finished lanes",
				);
				return [{ ok, why: ok ? "Finished report" : "no Finished report" }];
			},
		},
	],
	rubric: [],
};
