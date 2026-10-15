import {
	arborCalls,
	CHECKS,
	type Verdict,
} from "@webappwiz/arbor/skill-checks";
import type { EndRepo } from "./fixture";
import { lastSaid, openQuestions, turnsOf } from "./reading";
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
 * The checks every scenario runs: `skill-checks`, which `arbor dev` runs on
 * real conversations too, then the ones only an eval can tell, since they
 * need the repository a run left behind or the reads `arbor dev` does not
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
		rule: "Reads the arbor skill before any project file",
		judge: ({ log }) => {
			const first = log.tools.filter((tool) => tool.turn === 1);
			const skill = first.findIndex(
				(tool) => tool.name === "Skill" && tool.input.skill === "arbor",
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
		id: "report-body",
		rule: "Puts one sentence under 25 words and at most three bullets under a task report's title",
		judge: ({ log }) =>
			turnsOf(log.transcript.beats).flatMap((turn) => {
				const report = lastSaid(turn);
				const title = report
					.split("\n")
					.findIndex((line) => TASK_REPORT.test(line));
				return title === -1
					? []
					: [reportBody(report.split("\n").slice(title + 1))];
			}),
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

/** For a scenario that asks for a code change: `arbor add` comes before reading any code. */
export const STARTS: EvalCheck = {
	id: "starts",
	rule: "Adds its task before reading code",
	judge: ({ log }) => {
		const add = log.tools.findIndex(
			(tool) =>
				tool.name === "Bash" &&
				arborCalls(String(tool.input.command ?? "")).some(
					(call) => call.verb === "add" && !call.args.includes("--help"),
				),
		);
		const read = log.tools.findIndex(
			(tool) =>
				(tool.name === "Read" &&
					String(tool.input.file_path ?? "").includes("src/")) ||
				(tool.name === "Bash" &&
					/\bsrc\//.test(String(tool.input.command ?? "")) &&
					arborCalls(String(tool.input.command ?? "")).every(
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
const TASK_REPORT =
	/^## (✅ Merged|🛑 Removed|⚠️? ?Escalated|🔍 Ready to merge) /u;

const NUMBERED = /^\s*\d+\.\s/;

/** The most words the sentence under a report's title may have. */
const MAX_WORDS = 24;

/** The most `- ` lines a report may add after its sentence, beyond assumptions. */
const MAX_BULLETS = 3;

function reportBody(lines: string[]): Verdict {
	const body = lines.join("\n").trim().split("\n");
	const blank = body.findIndex((line) => line.trim() === "");
	const sentence = body.slice(0, blank === -1 ? undefined : blank).join(" ");
	const plain = sentence
		.replace(/`[^`]*`/g, "code")
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
	const sentences = plain
		.split(/[.!?](?=\s|$)/)
		.filter((each) => each.trim() !== "").length;
	const words = plain.split(/\s+/).filter(Boolean).length;
	// The bullets come before any todo, demo, question or checks line.
	const rest = body.slice(blank === -1 ? body.length : blank);
	const stop = rest.findIndex(
		(line) =>
			/^#{2,3} /.test(line) || NUMBERED.test(line) || /^Checks:/.test(line),
	);
	const bullets = rest
		.slice(0, stop === -1 ? undefined : stop)
		.filter((line) => /^- /.test(line) && !/^- Assumed/.test(line)).length;
	const ok = sentences === 1 && words <= MAX_WORDS && bullets <= MAX_BULLETS;
	return {
		ok,
		why: `${sentences} sentence${sentences === 1 ? "" : "s"}, ${words} words, ${bullets} bullets`,
	};
}

/** Whether a tool call reads a file of the project rather than the skill. */
function readsProject(tool: {
	name: string;
	input: Record<string, unknown>;
}): boolean {
	if (tool.name === "Read") {
		return !String(tool.input.file_path ?? "").includes("skills/arbor");
	}
	return (
		tool.name === "Bash" &&
		/\bsrc\/|\bCLAUDE\.md\b/.test(String(tool.input.command ?? ""))
	);
}
