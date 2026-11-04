import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { commandsOf } from "./agents";
import {
	CONTRACT_FORMAT,
	type ContractBatch,
	type ContractDetail,
	type ContractResult,
	type EvalCheck,
	RESULTS_FILE,
} from "./contract";
import { judgePrompt, judge as realJudge, type Verdict } from "./judge";
import { restoreRun } from "./keep";
import { revisionOf } from "./revision";
import type { Outcome, Repo, Scenario } from "./scenario";

/** A scenario to grade against, and the skill directory it belongs to. */
export interface Current {
	scenario: Scenario;
	dir: string;
}

export interface RegradeOptions {
	/** Re-run the judge too; it costs tokens, so the person starts it. */
	judge?: boolean;
	/** Writes a new batch here instead of nothing. */
	out?: string;
	/** Stands in for the real judge in tests. */
	judgeWith?: (prompt: string, env: Record<string, string>) => Promise<Verdict>;
}

export type Verdict3 = "pass" | "fail" | "error";

/** One run whose pass or fail changed. */
export interface Flip {
	run: string;
	scenario: string;
	agent: string;
	was: Verdict3;
	now: Verdict3;
	/** Checks whose result changed, `id: pass -> fail`. */
	checks: string[];
	/** True when the judge was re-run and its verdict changed. */
	judge?: string;
}

export interface RegradeReport {
	batch: string;
	/** What the batch ran, and what the scenarios are now. */
	was: { scenarioHash: string; skillHash: string; commit?: string } | null;
	now: { scenarioHash: string; skillHash: string; commit?: string } | null;
	regraded: number;
	/** The verdict each regraded run got now. */
	graded: { run: string; scenario: string; now: Verdict3 }[];
	flips: Flip[];
	/** Runs left as they were, with why. */
	skipped: { run: string; scenario: string; why: string }[];
	/** Checks that could not be re-run because the run kept no repo. */
	unchecked: { run: string; scenario: string; checks: string[] }[];
	out?: string;
}

/**
 * Re-grades the batch in `dir` with `current` scenarios' checks (and the judge
 * with `judge`), reporting each run whose verdict flipped. Writes nothing into
 * `dir`; with `out` it writes a new batch there.
 */
export async function regradeBatch(
	dir: string,
	current: readonly Current[],
	opts: RegradeOptions = {},
): Promise<RegradeReport> {
	const manifest = JSON.parse(
		await readFile(join(dir, "batch.json"), "utf8"),
	) as ContractBatch;
	if (manifest.format !== CONTRACT_FORMAT) {
		throw new Error(`${dir} is not a ${CONTRACT_FORMAT} batch`);
	}
	const lines = (await readFile(join(dir, RESULTS_FILE), "utf8"))
		.split("\n")
		.filter((each) => each !== "")
		.map((each) => JSON.parse(each) as ContractResult);
	const judging = opts.judgeWith ?? realJudge;
	const report: RegradeReport = {
		batch: dir,
		was: manifest.revision ?? null,
		now: null,
		regraded: 0,
		graded: [],
		flips: [],
		skipped: [],
		unchecked: [],
	};
	const details = new Map<string, ContractDetail>();
	const updated = new Map<string, ContractResult>();
	for (const line of lines) {
		const cell = manifest.cells.find((each) => each.id === line.cell);
		if (cell === undefined) {
			continue;
		}
		const found = current.find((each) => each.scenario.id === cell.case);
		const skip = (why: string) =>
			report.skipped.push({ run: line.cell, scenario: cell.case, why });
		if (found === undefined) {
			skip("the scenario no longer exists");
			continue;
		}
		if (line.status === "error") {
			skip("the run errored, so it has nothing to grade");
			continue;
		}
		report.now ??= await revisionOf(found.dir);
		const detailFile = line.detail ?? `${line.cell}.json`;
		const detail = JSON.parse(
			await readFile(join(dir, detailFile), "utf8"),
		) as ContractDetail;
		const transcript = detail.transcript ?? [];
		let restored: Awaited<ReturnType<typeof restoreRun>> | null = null;
		if (detail.repo !== undefined) {
			restored = await restoreRun(dir, line.cell);
		}
		const outcome: Outcome = restored?.outcome ?? {
			reply: detail.reply ?? "",
			transcript,
			commands: commandsOf(transcript),
			repo: missingRepo(),
		};
		try {
			const before = new Map(
				(detail.checks ?? []).map((each) => [each.id, each]),
			);
			const checks: EvalCheck[] = [];
			const unchecked: string[] = [];
			for (const check of found.scenario.checks ?? []) {
				try {
					checks.push({
						id: check.id,
						about: check.about,
						pass: await check.test(outcome),
					});
				} catch (error) {
					if (error instanceof NoRepo) {
						unchecked.push(check.id);
						const old = before.get(check.id);
						if (old !== undefined) {
							checks.push(old);
						}
						continue;
					}
					checks.push({
						id: check.id,
						about: check.about,
						pass: false,
						error: String(error),
					});
				}
			}
			let verdict = detail.judge;
			let judgeChange: string | undefined;
			if (opts.judge === true && found.scenario.judge !== undefined) {
				const fresh = await judging(
					judgePrompt({
						requirement: found.scenario.requirement,
						rubric: found.scenario.judge,
						message: found.scenario.message,
						transcript,
						reply: detail.reply ?? "",
					}),
					{ ...(process.env as Record<string, string>) },
				);
				verdict = { pass: fresh.pass, reason: fresh.reason };
				if (fresh.pass !== detail.judge?.pass) {
					judgeChange = `${detail.judge?.pass ? "pass" : "fail"} -> ${fresh.pass ? "pass" : "fail"}`;
				}
			}
			const status: Verdict3 =
				checks.every((each) => each.pass) && (verdict?.pass ?? true)
					? "pass"
					: "fail";
			report.regraded += 1;
			report.graded.push({ run: line.cell, scenario: cell.case, now: status });
			if (unchecked.length > 0) {
				report.unchecked.push({
					run: line.cell,
					scenario: cell.case,
					checks: unchecked,
				});
			}
			const changed = checks.flatMap((now) => {
				const old = before.get(now.id);
				return old === undefined || old.pass !== now.pass
					? [
							`${now.id}: ${old === undefined ? "new" : old.pass ? "pass" : "fail"} -> ${now.pass ? "pass" : "fail"}`,
						]
					: [];
			});
			if (status !== line.status) {
				report.flips.push({
					run: line.cell,
					scenario: cell.case,
					agent: [cell.target.agent, cell.target.model]
						.filter((part) => part !== undefined && part !== "")
						.join(":"),
					was: line.status,
					now: status,
					checks: changed,
					...(judgeChange === undefined ? {} : { judge: judgeChange }),
				});
			}
			details.set(line.cell, {
				...detail,
				checks,
				...(verdict === undefined ? {} : { judge: verdict }),
			});
			updated.set(line.cell, { ...line, status });
		} finally {
			await restored?.remove();
		}
	}
	if (opts.out !== undefined) {
		report.out = opts.out;
		await writeOut(dir, opts.out, manifest, lines, details, updated, report);
	}
	return report;
}

class NoRepo extends Error {}

/** A repo for a run that kept none: any check that reaches for it is skipped. */
function missingRepo(): Repo {
	const fail = (): never => {
		throw new NoRepo("the run kept no repo");
	};
	return {
		get dir(): string {
			return fail();
		},
		write: async () => fail(),
		run: async () => fail(),
	};
}

async function writeOut(
	dir: string,
	out: string,
	manifest: ContractBatch,
	lines: readonly ContractResult[],
	details: ReadonlyMap<string, ContractDetail>,
	updated: ReadonlyMap<string, ContractResult>,
	report: RegradeReport,
): Promise<void> {
	await mkdir(out, { recursive: true });
	if ((await readdir(out)).length > 0) {
		throw new Error(`${out} is not empty`);
	}
	await cp(dir, out, { recursive: true });
	for (const [cell, detail] of details) {
		const file =
			lines.find((each) => each.cell === cell)?.detail ?? `${cell}.json`;
		await writeFile(join(out, file), JSON.stringify(detail, null, "\t"));
	}
	await writeFile(
		join(out, RESULTS_FILE),
		lines
			.map((each) => `${JSON.stringify(updated.get(each.cell) ?? each)}\n`)
			.join(""),
	);
	const next: ContractBatch = {
		...manifest,
		title: `${manifest.title ?? ""} (regraded)`.trim(),
		...(report.now === null ? {} : { revision: report.now }),
	};
	await writeFile(join(out, "batch.json"), JSON.stringify(next, null, "\t"));
}

/** The report as text. */
export function formatReport(report: RegradeReport): string {
	const hash = (rev: RegradeReport["was"]) =>
		rev === null ? "none recorded" : rev.scenarioHash.slice(0, 12);
	const out = [
		`scenarios: batch ${hash(report.was)}  now ${hash(report.now)}${
			report.was !== null &&
			report.now !== null &&
			report.was.scenarioHash === report.now.scenarioHash
				? "  (unchanged)"
				: ""
		}`,
		`regraded ${report.regraded} runs, ${report.flips.length} flipped`,
	];
	for (const flip of report.flips) {
		out.push(
			`${flip.run}\t${flip.scenario}\t${flip.agent}\t${flip.was} -> ${flip.now}\t${[...flip.checks, ...(flip.judge === undefined ? [] : [`judge: ${flip.judge}`])].join("; ")}`,
		);
	}
	for (const each of report.unchecked) {
		out.push(
			`${each.run}\t${each.scenario}\tno repo kept; skipped checks: ${each.checks.join(", ")}`,
		);
	}
	for (const each of report.skipped) {
		out.push(`${each.run}\t${each.scenario}\tnot regraded: ${each.why}`);
	}
	if (report.out !== undefined) {
		out.push(`wrote ${report.out}`);
	}
	return out.join("\n");
}
