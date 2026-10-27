import { mkdtemp, realpath, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
	type EvalDetail,
	EvalStore,
	targetName,
} from "@stringsync/splates-server/evals";
import { AGENTS, type AgentPick } from "./agents";
import { migrate } from "./migrate";
import { type Cell, type Result, runBatch, type SkillUsed } from "./run";
import { SCENARIOS } from "./scenarios";

const HELP = `splates dev eval: run the splates skill's eval scenarios on real agents.

  list                       every scenario: id, aspect, requirement, kind
  plan  [selection]          how many runs a selection comes to, and at most what it costs
  run   [selection]          runs it into a new batch-* directory (costs tokens)
  report <batch>             each scenario's pass rate, why runs failed, and errors apart
  show <batch> <run>         one run: its message, checks, judge, every step and the reply;
                             also takes a run id, batch-x#run-003
  migrate                    rewrites batches saved before splates-evals/1 in that format

Selection:
  --scenario <id>            a scenario, repeatable; all when none
  --agent <agent[:model][@effort]>
                             claude, codex or opencode, repeatable; claude when none
  --baseline <rev>           also runs each with the skill as it was at <rev>
  --reps <n>                 runs of each, 1 by default
  --skill <dir>              the skill to run, this checkout's skills/splates by default
  --directory <dir>          where batches go, ~/.splates/evals by default
  --parallel <n>             runs at once, 2 by default

Each run is graded by its code checks and, where it has one, a judge.`;

/** What each run may spend at most, agent and judge together, for the plan's ceiling. */
const RUN_USD = 1.05;

const DEFAULT_DIRECTORY = join(homedir(), ".splates", "evals");
const DEFAULT_SKILL = resolve(import.meta.dir, "../../skills/splates");

/** `claude:sonnet@high` as a pick. */
export function pickOf(text: string): AgentPick {
	const [, agent, model, effort] =
		/^([^:@]+)(?::([^@]+))?(?:@(.+))?$/.exec(text) ?? [];
	if (agent === undefined || !AGENTS.includes(agent)) {
		throw new Error(
			`no eval runner for agent ${text}; one of ${AGENTS.join(", ")}`,
		);
	}
	return {
		agent,
		...(model === undefined ? {} : { model }),
		...(effort === undefined ? {} : { effort }),
	};
}

async function main(argv: string[]): Promise<number> {
	const { values, positionals } = parseArgs({
		args: argv,
		allowPositionals: true,
		options: {
			scenario: { type: "string", multiple: true, default: [] },
			agent: { type: "string", multiple: true, default: [] },
			baseline: { type: "string" },
			reps: { type: "string", default: "1" },
			skill: { type: "string", default: DEFAULT_SKILL },
			directory: { type: "string", default: DEFAULT_DIRECTORY },
			parallel: { type: "string", default: "2" },
			help: { type: "boolean", default: false },
		},
	});
	const [command, ...rest] = positionals;
	if (values.help || command === undefined) {
		console.log(HELP);
		return 0;
	}
	if (command === "list") {
		for (const each of SCENARIOS) {
			console.log([each.id, each.aspect, each.requirement, "agent"].join("\t"));
		}
		return 0;
	}
	if (command === "report") {
		const batch = rest[0];
		if (batch === undefined) {
			console.error("report names a batch directory");
			return 2;
		}
		console.log(await report(new EvalStore(values.directory), batch));
		return 0;
	}
	if (command === "show") {
		const id = runId(rest);
		if (id === null) {
			console.error(
				"show names a run: a batch and its run (run-003 or 3), or a run id as batch-x#run-003",
			);
			return 2;
		}
		console.log(shown(await new EvalStore(values.directory).run(id)));
		return 0;
	}
	if (command === "migrate") {
		for (const batch of await migrate(values.directory)) {
			console.log(`migrated ${batch}`);
		}
		return 0;
	}
	if (command !== "plan" && command !== "run") {
		console.error(`no eval command ${command}\n\n${HELP}`);
		return 2;
	}
	const unknown = values.scenario.filter(
		(id) => !SCENARIOS.some((each) => each.id === id),
	);
	if (unknown.length > 0) {
		console.error(`no scenario ${unknown.join(", ")}`);
		return 2;
	}
	const scenarios =
		values.scenario.length === 0
			? SCENARIOS
			: SCENARIOS.filter((each) => values.scenario.includes(each.id));
	const agents = (values.agent.length === 0 ? ["claude"] : values.agent).map(
		pickOf,
	);
	const reps = Math.max(1, Number(values.reps) || 1);
	const skills: { dir: string; used: SkillUsed }[] = [
		{ dir: values.skill, used: { label: "current", revision: null } },
	];
	const extracted: string[] = [];
	if (values.baseline !== undefined) {
		const dir = await skillAt(values.skill, values.baseline);
		extracted.push(dir);
		skills.push({
			dir,
			used: { label: values.baseline, revision: values.baseline },
		});
	}
	const cells: Cell[] = scenarios.flatMap((scenario) =>
		agents.flatMap((agent) =>
			skills.flatMap((skill) =>
				Array.from({ length: reps }, (_, repetition) => ({
					scenario,
					agent,
					skill,
					repetition,
				})),
			),
		),
	);
	if (command === "plan") {
		console.log(`runs ${cells.length}`);
		console.log(`usd ${(cells.length * RUN_USD).toFixed(2)}`);
		await Promise.all(extracted.map((dir) => rm(dir, { recursive: true })));
		return 0;
	}
	try {
		const batch = await runBatch(cells, {
			directory: values.directory,
			skill: "splates",
			parallel: Number(values.parallel) || 2,
			landed: (result) =>
				console.log(
					`${result.status}\t${result.scenario.id}\t${pickLabel(result)}${result.error === null ? "" : `\t${result.error}`}`,
				),
		});
		console.log(`batch ${batch}`);
		return 0;
	} finally {
		await Promise.all(extracted.map((dir) => rm(dir, { recursive: true })));
	}
}

/** The skill directory `skill` held at `revision`, copied out of git into a temp directory. */
async function skillAt(skill: string, revision: string): Promise<string> {
	const prefix = (
		await output(["git", "-C", skill, "rev-parse", "--show-prefix"])
	).trim();
	const dir = await mkdtemp(
		join(await realpath(tmpdir()), "splates-eval-skill-"),
	);
	const top = (
		await output(["git", "-C", skill, "rev-parse", "--show-toplevel"])
	).trim();
	// From a subdirectory, git archive keeps only that subdirectory of the
	// tree it is given, which inside `skills/splates` is nothing.
	const archive = Bun.spawn(
		["git", "-C", top, "archive", "--format=tar", `${revision}:${prefix}`],
		{ stdout: "pipe", stderr: "pipe" },
	);
	const tar = Bun.spawn(["tar", "-x", "-C", dir], {
		stdin: archive.stdout,
		stderr: "pipe",
	});
	if (
		(await archive.exited) !== 0 ||
		(await tar.exited) !== 0 ||
		!(await Bun.file(join(dir, "SKILL.md")).exists())
	) {
		await rm(dir, { recursive: true, force: true });
		throw new Error(
			`no skill at ${revision}: ${(await new Response(archive.stderr).text()).trim()}`,
		);
	}
	return dir;
}

async function output(argv: string[]): Promise<string> {
	const child = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe" });
	const [text, code] = await Promise.all([
		new Response(child.stdout).text(),
		child.exited,
	]);
	if (code !== 0) {
		throw new Error(`${argv.join(" ")} exited ${code}`);
	}
	return text;
}

/** Batch `id`'s landed runs, opened, summed up as `summary` does. */
async function report(store: EvalStore, id: string): Promise<string> {
	const grid = await store.grid(id);
	if (grid === null) {
		throw new Error(`no eval batch ${id}`);
	}
	return summary(
		await Promise.all(
			grid.grid.flatMap((cell) =>
				cell.run === null ? [] : [store.run(cell.run.id)],
			),
		),
	);
}

/**
 * Each scenario's pass rate on each target, with why each failing run
 * failed under it; then the runs that errored, apart, since an error is the
 * harness's or the setup's, never the skill's.
 */
export function summary(runs: readonly EvalDetail[]): string {
	const failed = runs.filter((run) => run.status !== "error");
	const errored = runs.filter((run) => run.status === "error");
	const lines: string[] = [];
	for (const scenario of [...new Set(failed.map((run) => run.scenario))]) {
		lines.push(scenario);
		const ofScenario = failed.filter((run) => run.scenario === scenario);
		for (const who of [
			...new Set(ofScenario.map((run) => targetName(run.target))),
		]) {
			const cell = ofScenario.filter((run) => targetName(run.target) === who);
			const passed = cell.filter((run) => run.status === "pass").length;
			lines.push(`  ${who}\t${passed}/${cell.length} pass`);
			for (const run of cell) {
				if (run.status === "pass") {
					continue;
				}
				lines.push(`    ${cellOf(run.id)} ${run.status}`);
				for (const reason of held(run)) {
					lines.push(`      ${reason}`);
				}
			}
		}
	}
	if (errored.length > 0) {
		lines.push(
			"",
			"Errors, the harness's or the setup's, not the skill's:",
			...errored.map(
				(run) =>
					`  ${cellOf(run.id)} ${run.scenario} ${targetName(run.target)}: ${run.error ?? "no error saved"}`,
			),
		);
	}
	return lines.join("\n");
}

/** What held a run back: each failing check, and the judge's reason when it failed it. */
function held(run: EvalDetail): string[] {
	return [
		...run.checks
			.filter((check) => !check.pass)
			.map((check) => `${check.id}: ${check.about}`),
		...(run.judge?.pass === false ? [`judge: ${run.judge.reason}`] : []),
	];
}

/** `run-003` of the run id `batch-x#run-003`. */
function cellOf(id: string): string {
	return id.slice(id.lastIndexOf("#") + 1);
}

/**
 * A run's id from `show`'s arguments: a batch and its run as `run-003` or
 * `3`, or a run id as the Evals page and `[SPLATES EVALS DONE]` name it,
 * `batch-x#run-003`; null for neither.
 */
export function runId(args: readonly string[]): string | null {
	const [first, run] = args;
	if (first === undefined) {
		return null;
	}
	if (run === undefined) {
		return first.includes("#") ? first : null;
	}
	const name = /^\d+$/.test(run) ? `run-${run.padStart(3, "0")}` : run;
	return `${first}#${name}`;
}

/** How long one step's input or output is let run in `show`. */
const STEP_CUT = 600;

/**
 * One run in full, to diagnose it: what it asked, its status and what held
 * it back, each step the agent took (its words, each tool call and what came
 * back, cut short), and the reply.
 */
export function shown(run: EvalDetail): string {
	const cut = (text: string) =>
		text.length <= STEP_CUT ? text : `${text.slice(0, STEP_CUT)}…`;
	const indent = (text: string, by: string) =>
		text
			.split("\n")
			.map((line) => by + line)
			.join("\n");
	const reasons = [
		...held(run),
		...(run.error === undefined ? [] : [run.error]),
	];
	return [
		`${run.status}\t${run.scenario}\t${targetName(run.target)}, repetition ${run.repetition + 1}`,
		`Requirement: ${run.requirement}`,
		...reasons.map((reason) => `Held back: ${reason}`),
		...(run.judge?.pass === true ? [`Judge passed: ${run.judge.reason}`] : []),
		"",
		"Message:",
		indent(run.input, "  "),
		"",
		"Steps:",
		...run.transcript.map((step) =>
			step.kind === "text"
				? indent(cut(step.text), "  ")
				: `  > ${step.name} ${cut(step.input)}\n${indent(cut(step.output ?? "(no output)"), "    < ")}`,
		),
		"",
		"Reply:",
		indent(run.reply || "(none)", "  "),
	].join("\n");
}

/** A run's agent as `run` prints each as it lands. */
function pickLabel(result: Result): string {
	return [
		result.agent.agent,
		result.agent.model,
		result.agent.effort,
		result.skill.revision === null ? null : `@${result.skill.label}`,
	]
		.filter((part) => part != null)
		.join(" ");
}

if (import.meta.main) {
	main(process.argv.slice(2)).then(
		(code) => process.exit(code),
		(error: unknown) => {
			console.error(error instanceof Error ? error.message : String(error));
			process.exit(1);
		},
	);
}
