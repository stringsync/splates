import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { AGENTS, type AgentPick } from "../agents";
import {
	CONTRACT_FORMAT,
	type ContractBatch,
	type ContractDetail,
	type ContractResult,
	RESULTS_FILE,
} from "../contract";
import { fingerprintOf } from "../fingerprint";
import { checkLabel, copyRun } from "../labels";
import { formatReport, regradeBatch } from "../regrade";
import { revisionOf } from "../revision";
import { type Cell, runBatch } from "../run";
import { discover, discoverLabels, type Found, problems } from "./discover";
import { definitionOf } from "./list-entry";

const HELP = `evals: run the eval scenarios kept beside each skill, like a linter.

Scenarios are <project>/skills/<skill>/evals/*.ts, each exporting \`scenarios\`.

  list [--json]            every scenario by skill: id, requirement; JSON lines with --json
  check [--judge]          validates every scenario, and re-grades every labelled run with
                           today's code checks, failing where a verdict disagrees with its
                           label; no model, but --judge re-runs the judge on labelled runs
                           and says how many it agrees with
                           too (costs tokens, so only the person starts it); for bin/mono fix
  label <batch> <run> --skill <name> --expect pass|fail --why <text> [--name <dir>]
                           copies a stored run, scrubbed of secrets, into the skill's
                           evals/labels/ and prints the label to export as \`labels\`
  plan [selection] [--json] runs a selection comes to, and at most what it costs
  run  [selection]         runs it into a new batch-* directory (costs tokens)
  regrade <batch-dir> [--judge] [--out <dir>]
                           re-runs today's code checks on a stored batch's runs and lists
                           each whose pass or fail flipped; --judge re-runs the judge too
                           (costs tokens), --out writes the result as a new batch
  show <batch> <run>       one run: message, checks, judge, every step and the reply;
                           also takes a run id, batch-x#run-003

Selection:
  --skill <name>           a skill, repeatable; all when none
  --scenario <id>          a scenario, repeatable; all when none
  --agent <agent[:model][@effort]>
                           claude, codex, opencode or kimi, repeatable; claude when none
  --reps <n>               runs of each, 1 by default
  --parallel <n>           runs at once, 2 by default
  --directory <dir>        where batches go, ~/.splates/evals by default
  --root <dir>             where to look for scenarios, this checkout by default`;

/** What each run may spend at most, agent and judge together. */
const RUN_USD = 1.05;

/** `claude:sonnet@high` as a pick. */
export function pickOf(text: string): AgentPick {
	const [, agent, model, effort] =
		/^([^:@]+)(?::([^@]+))?(?:@(.+))?$/.exec(text) ?? [];
	if (agent === undefined || !AGENTS.includes(agent)) {
		throw new Error(`no agent ${text}; one of ${AGENTS.join(", ")}`);
	}
	return {
		agent,
		...(model === undefined ? {} : { model }),
		...(effort === undefined ? {} : { effort }),
	};
}

/** The scenarios of `found` that `skills` and `ids` select; all when both are empty. */
export function select(
	found: readonly Found[],
	skills: readonly string[],
	ids: readonly string[],
): Found[] {
	return found.filter(
		(each) =>
			(skills.length === 0 || skills.includes(each.skill)) &&
			(ids.length === 0 || ids.includes(each.scenario.id)),
	);
}

/** One cell for each scenario, agent and repetition. */
export function cellsOf(
	selected: readonly Found[],
	agents: readonly AgentPick[],
	reps: number,
): Cell[] {
	return selected.flatMap(({ scenario, dir, sandbox }) =>
		agents.flatMap((agent) =>
			Array.from({ length: reps }, (_, repetition) => ({
				scenario,
				...(sandbox === undefined ? {} : { sandbox }),
				agent,
				skill: { dir, used: { label: "current", revision: null } },
				repetition,
			})),
		),
	);
}

async function main(argv: string[]): Promise<number> {
	const { values, positionals } = parseArgs({
		args: argv,
		allowPositionals: true,
		options: {
			skill: { type: "string", multiple: true, default: [] },
			scenario: { type: "string", multiple: true, default: [] },
			agent: { type: "string", multiple: true, default: [] },
			reps: { type: "string", default: "1" },
			parallel: { type: "string", default: "2" },
			directory: {
				type: "string",
				default: join(homedir(), ".splates", "evals"),
			},
			root: { type: "string", default: gitRoot() },
			json: { type: "boolean", default: false },
			judge: { type: "boolean", default: false },
			out: { type: "string" },
			expect: { type: "string" },
			why: { type: "string" },
			name: { type: "string" },
			help: { type: "boolean", default: false },
		},
	});
	const [command, ...rest] = positionals;
	const rejudge = values.judge;
	if (values.help || command === undefined) {
		console.log(HELP);
		return 0;
	}
	if (command === "show") {
		const id = runId(rest);
		if (id === null) {
			console.error(
				"show names a batch and its run: batch-x run-003, or batch-x#run-003",
			);
			return 2;
		}
		console.log(await shown(values.directory, id.batch, id.run));
		return 0;
	}
	if (command === "label") {
		const id = runId(rest);
		const [skill] = values.skill;
		if (
			id === null ||
			skill === undefined ||
			(values.expect !== "pass" && values.expect !== "fail") ||
			values.why === undefined
		) {
			console.error(
				"label names a batch and run, --skill, --expect pass|fail and --why",
			);
			return 2;
		}
		const found = (await discover(resolve(values.root))).filter(
			(each) => each.skill === skill,
		);
		const first = found[0];
		if (first === undefined) {
			console.error(`no skill ${skill} with scenarios`);
			return 2;
		}
		const batchDir = (
			await readdir(values.directory).catch((): string[] => [])
		).includes(id.batch)
			? join(values.directory, id.batch)
			: resolve(id.batch);
		const name = values.name ?? `${id.batch}-${id.run}`;
		const manifest = (await Bun.file(
			join(batchDir, "batch.json"),
		).json()) as ContractBatch;
		const scenario = manifest.cells.find((each) => each.id === id.run)?.case;
		if (scenario === undefined) {
			console.error(`no run ${id.run} in ${batchDir}`);
			return 2;
		}
		await copyRun(batchDir, id.run, join(first.dir, "evals", "labels", name));
		console.log(
			`copied to ${join(first.dir, "evals", "labels", name)}\nadd to an evals file's \`labels\`:\n${JSON.stringify({ scenario, run: `labels/${name}`, expect: values.expect, why: values.why }, null, "\t")}`,
		);
		return 0;
	}
	if (command === "regrade") {
		const [batchDir] = rest;
		if (batchDir === undefined) {
			console.error("regrade names a batch directory");
			return 2;
		}
		const found = await discover(resolve(values.root));
		const dir = (
			await readdir(values.directory).catch((): string[] => [])
		).includes(batchDir)
			? join(values.directory, batchDir)
			: resolve(batchDir);
		const report = await regradeBatch(dir, found, {
			judge: rejudge,
			...(values.out === undefined ? {} : { out: resolve(values.out) }),
		});
		console.log(formatReport(report));
		return 0;
	}
	if (!["list", "check", "plan", "run"].includes(command)) {
		console.error(`no evals command ${command}\n\n${HELP}`);
		return 2;
	}
	const found = await discover(resolve(values.root));
	if (command === "list") {
		const hashes = new Map<string, string>();
		for (const each of found) {
			const { id, aspect, requirement } = each.scenario;
			let skillHash = hashes.get(each.dir);
			if (skillHash === undefined) {
				skillHash = (await revisionOf(each.dir)).skillHash;
				hashes.set(each.dir, skillHash);
			}
			const fingerprint = fingerprintOf(each.scenario, skillHash);
			console.log(
				values.json
					? JSON.stringify({
							case: id,
							group: aspect,
							about: requirement,
							skill: each.skill,
							fingerprint,
							...definitionOf(each.scenario),
						})
					: [each.skill, id, requirement, fingerprint].join("\t"),
			);
		}
		return 0;
	}
	if (command === "check") {
		const wrong = problems(found);
		const labelled = await discoverLabels(resolve(values.root));
		const current = found.map(({ scenario, dir }) => ({ scenario, dir }));
		let disagree = 0;
		for (const each of labelled) {
			const why = await checkLabel(each.label, each.base, current, {
				judge: rejudge,
			});
			if (why !== null) {
				disagree += 1;
				wrong.push(`${each.file}: ${why}`);
			}
		}
		for (const line of wrong) {
			console.error(line);
		}
		console.log(
			`${found.length} scenarios, ${labelled.length} labelled runs, ${wrong.length} problems`,
		);
		if (rejudge) {
			console.log(
				`judge: agrees with ${labelled.length - disagree} of ${labelled.length} labelled runs`,
			);
		}
		return wrong.length === 0 ? 0 : 1;
	}
	const unknown = values.scenario.filter(
		(id) => !found.some((each) => each.scenario.id === id),
	);
	const unknownSkills = values.skill.filter(
		(name) => !found.some((each) => each.skill === name),
	);
	if (unknown.length > 0 || unknownSkills.length > 0) {
		console.error(
			`no scenario or skill ${[...unknown, ...unknownSkills].join(", ")}`,
		);
		return 2;
	}
	const agents = (values.agent.length === 0 ? ["claude"] : values.agent).map(
		pickOf,
	);
	const cells = cellsOf(
		select(found, values.skill, values.scenario),
		agents,
		Math.max(1, Number(values.reps) || 1),
	);
	if (command === "plan") {
		const usd = Number((cells.length * RUN_USD).toFixed(2));
		console.log(
			values.json
				? JSON.stringify({ cells: cells.length, usd })
				: `runs ${cells.length}\nusd ${usd.toFixed(2)}`,
		);
		return 0;
	}
	const batch = await runBatch(cells, {
		directory: values.directory,
		skill: values.skill.join(", ") || "all",
		producer: "evals",
		parallel: Number(values.parallel) || 2,
		landed: (result) =>
			console.log(
				`${result.status}\t${result.scenario.id}\t${result.agent.agent}${result.error === null ? "" : `\t${result.error}`}`,
			),
	});
	console.log(`batch ${batch}`);
	return 0;
}

/** A run named as `batch-x run-003`, `batch-x 3` or `batch-x#run-003`. */
export function runId(
	args: readonly string[],
): { batch: string; run: string } | null {
	const [first, second] = args;
	if (first === undefined) {
		return null;
	}
	const [batch, run] = first.includes("#") ? first.split("#") : [first, second];
	if (batch === undefined || run === undefined || batch === "" || run === "") {
		return null;
	}
	return {
		batch,
		run: /^\d+$/.test(run) ? `run-${run.padStart(3, "0")}` : run,
	};
}

/** One run in full: what it was asked, how it was graded, and every step. */
async function shown(
	directory: string,
	batch: string,
	run: string,
): Promise<string> {
	const dir = (await readdir(directory)).includes(batch)
		? join(directory, batch)
		: resolve(batch);
	const manifest = (await Bun.file(
		join(dir, "batch.json"),
	).json()) as ContractBatch;
	if (manifest.format !== CONTRACT_FORMAT) {
		throw new Error(`${dir} is not a ${CONTRACT_FORMAT} batch`);
	}
	const cell = manifest.cells.find((each) => each.id === run);
	const line = (await Bun.file(join(dir, RESULTS_FILE)).text())
		.split("\n")
		.filter((each) => each !== "")
		.map((each) => JSON.parse(each) as ContractResult)
		.find((each) => each.cell === run);
	if (cell === undefined || line === undefined) {
		throw new Error(`no finished run ${run} in ${dir}`);
	}
	const detail = (await Bun.file(
		join(dir, line.detail ?? `${run}.json`),
	).json()) as ContractDetail;
	const revision = manifest.revision;
	const out = [
		...(revision === undefined
			? []
			: [
					`revision: ${revision.commit ?? "no commit"}  skill ${revision.skillHash.slice(0, 12)}  scenarios ${revision.scenarioHash.slice(0, 12)}`,
				]),
		`${line.status}  ${cell.case}  ${cell.target.agent ?? ""} ${cell.target.model}`.trimEnd(),
		line.reason === undefined ? "" : `reason: ${line.reason}`,
		"",
		`message: ${detail.input ?? ""}`,
		"",
		...(detail.checks ?? []).map(
			(check) => `${check.pass ? "✓" : "✗"} ${check.id}: ${check.about}`,
		),
		...(detail.judge === undefined
			? []
			: [
					`judge ${detail.judge.pass ? "pass" : "fail"}: ${detail.judge.reason}`,
				]),
		"",
		...(detail.transcript ?? []).map((step) =>
			step.kind === "text"
				? `agent: ${step.text}`
				: `tool ${step.name}: ${step.input}\n  -> ${step.output ?? ""}`,
		),
		"",
		`reply: ${detail.reply ?? ""}`,
	];
	return out.join("\n");
}

function gitRoot(): string {
	const run = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"]);
	return run.exitCode === 0 ? run.stdout.toString().trim() : process.cwd();
}

if (import.meta.main) {
	main(process.argv.slice(2)).then(
		(code) => process.exit(code),
		(error) => {
			console.error(String(error instanceof Error ? error.message : error));
			process.exit(1);
		},
	);
}
