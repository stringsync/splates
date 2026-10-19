import {
	CHECKS,
	splatesCalls,
	type Verdict,
} from "@stringsync/splates-server/stats";
import type { EndRepo } from "./fixture";
import { lastSaid, openQuestions } from "./reading";
import type { RunLog } from "./transcript";

/** A rule a program can decide over one eval run; no verdicts where it does not apply. */
export interface EvalCheck {
	id: string;
	rule: string;
	judge(run: EvalRun): Verdict[];
}

/** One finished run, as the checks read it. */
export interface EvalRun {
	log: RunLog;
	end: EndRepo;
}

/**
 * The checks every scenario runs: `skill-checks`, which `splates server` runs on
 * real conversations too, then the ones only an eval can tell, since they
 * need the repository a run left behind or the reads `splates server` does not
 * keep.
 */
export const COMMON: readonly EvalCheck[] = [
	...CHECKS.map(
		(check): EvalCheck => ({
			id: check.id,
			rule: check.rule,
			judge: ({ log, end }) => check.judge(log.transcript, end),
		}),
	),
	{
		id: "skill-first",
		rule: "Reads the splates skill before any project file",
		judge: ({ log }) => {
			const first = log.tools.filter((tool) => tool.turn === 1);
			const skill = first.findIndex(
				(tool) => tool.name === "Skill" && tool.input.skill === "splates",
			);
			const read = first.findIndex(readsProject);
			const ok = skill !== -1 && (read === -1 || skill < read);
			return [
				{
					ok,
					why:
						skill === -1
							? "never read the skill"
							: ok
								? "skill first"
								: "read the project first",
				},
			];
		},
	},
	{
		id: "questions-in-report",
		rule: "Ends an escalation with every open question, numbered, its choices as written",
		judge: ({ log, end }) => {
			const report = lastSaid(log.transcript.beats);
			return end.tasks
				.filter((task) => task.status === "escalated" && task.plan !== null)
				.flatMap((task) =>
					openQuestions(task.plan ?? "").map((question) => {
						const listed = report
							.split("\n")
							.some(
								(line) =>
									NUMBERED.test(line) && line.includes(question.subject),
							);
						const missing = question.choices.find(
							(choice) => !report.includes(choice),
						);
						return {
							ok: listed && missing === undefined,
							why: !listed
								? `not asked: "${question.subject}"`
								: missing !== undefined
									? `choice changed: "${missing}"`
									: `asked "${question.subject}"`,
						};
					}),
				);
		},
	},
];

/** For a scenario that asks for a code change: `splates add` comes before reading any code. */
export const STARTS: EvalCheck = {
	id: "starts",
	rule: "Adds its task before reading code",
	judge: ({ log }) => {
		const add = log.tools.findIndex(
			(tool) =>
				tool.name === "Bash" &&
				splatesCalls(String(tool.input.command ?? "")).some(
					(call) => call.verb === "add" && !call.args.includes("--help"),
				),
		);
		const read = log.tools.findIndex(
			(tool) =>
				(tool.name === "Read" &&
					String(tool.input.file_path ?? "").includes("src/")) ||
				(tool.name === "Bash" &&
					/\bsrc\//.test(String(tool.input.command ?? "")) &&
					splatesCalls(String(tool.input.command ?? "")).every(
						(call) => call.verb !== "add",
					)),
		);
		const ok = add !== -1 && (read === -1 || add < read);
		return [
			{
				ok,
				why:
					add === -1 ? "added no task" : ok ? "added first" : "read code first",
			},
		];
	},
};

/** The title of a report on how a task ended, which `report-title` judges the form of. */
const NUMBERED = /^\s*\d+\.\s/;

/** Whether a tool call reads a file of the project rather than the skill. */
function readsProject(tool: {
	name: string;
	input: Record<string, unknown>;
}): boolean {
	if (tool.name === "Read") {
		return !String(tool.input.file_path ?? "").includes("skills/splates");
	}
	return (
		tool.name === "Bash" &&
		/\bsrc\/|\bCLAUDE\.md\b/.test(String(tool.input.command ?? ""))
	);
}
