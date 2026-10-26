import { mkdtemp, readdir, readFile, realpath, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { AGENTS, type AgentPick } from "./agents";
import { type Cell, type Result, runBatch, type SkillUsed } from "./run";
import { SCENARIOS } from "./scenarios";

const HELP = `splates dev eval: run the splates skill's eval scenarios on real agents.

  list                       every scenario: id, aspect, requirement, kind
  plan  [selection]          how many runs a selection comes to, and at most what it costs
  run   [selection]          runs it into a new batch-* directory (costs tokens)
  report <batch>             a batch's results

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
		console.log(await report(resolve(values.directory, batch)));
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
					`${result.status}\t${result.scenario.id}\t${label(result)}${result.error === null ? "" : `\t${result.error}`}`,
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
	const archive = Bun.spawn(
		["git", "-C", skill, "archive", "--format=tar", `${revision}:${prefix}`],
		{ stdout: "pipe", stderr: "pipe" },
	);
	const tar = Bun.spawn(["tar", "-x", "-C", dir], {
		stdin: archive.stdout,
		stderr: "pipe",
	});
	if ((await archive.exited) !== 0 || (await tar.exited) !== 0) {
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

/** A batch's runs, one line each: status, scenario, agent and skill, and what held it back. */
async function report(batch: string): Promise<string> {
	const runs = (await readdir(batch)).filter((each) => each.startsWith("run-"));
	const lines = await Promise.all(
		runs.sort().map(async (run) => {
			const result = JSON.parse(
				await readFile(join(batch, run, "result.json"), "utf8"),
			) as Result;
			const held = [
				...result.checks
					.filter((check) => !check.pass)
					.map((check) => `${check.id}: ${check.about}`),
				...(result.judge?.pass === false
					? [`judge: ${result.judge.reason}`]
					: []),
				...(result.error === null ? [] : [result.error]),
			];
			return `${result.status}\t${result.scenario.id}\t${label(result)}${held.length === 0 ? "" : `\n\t${held.join("\n\t")}`}`;
		}),
	);
	return lines.join("\n");
}

function label(result: Result): string {
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
