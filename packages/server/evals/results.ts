import type { Diagnosis } from "./diagnosis";
import type { EvalCell, EvalFailure, EvalTestResult } from "./types";

/**
 * Each test's landed runs on each target, in plan order, with its failures
 * grouped: one group per diagnosis that names its runs, then the errored runs
 * no diagnosis names (the harness's, known without one), then the failed runs
 * none names, not yet diagnosed. A run two diagnoses name is in both.
 */
export function testResults(
	grid: EvalCell[],
	diagnoses: Diagnosis[] | null,
): EvalTestResult[] {
	const byKey = new Map<string, EvalCell[]>();
	for (const cell of grid) {
		if (cell.run === null) {
			continue;
		}
		const key = `${cell.scenario}\n${cell.target}`;
		byKey.set(key, [...(byKey.get(key) ?? []), cell]);
	}
	return [...byKey.values()].map((cells) =>
		resultOf(
			[...cells].sort((first, second) => first.repetition - second.repetition),
			diagnoses ?? [],
		),
	);
}

function resultOf(cells: EvalCell[], diagnoses: Diagnosis[]): EvalTestResult {
	const first = cells[0] as EvalCell;
	const failed = cells.filter((cell) => cell.run?.status === "fail");
	const errored = cells.filter((cell) => cell.run?.status === "error");
	const diagnosed = new Set<string>();
	const failures: EvalFailure[] = [];
	for (const diagnosis of diagnoses) {
		const runs = [...failed, ...errored].filter((cell) =>
			diagnosis.runs.includes(cellOf(cell)),
		);
		if (runs.length === 0) {
			continue;
		}
		for (const cell of runs) {
			diagnosed.add(runId(cell));
		}
		failures.push({
			kind: "diagnosed",
			runs: sorted(runs),
			check: diagnosis.check,
			causes: diagnosis.causes,
			why: diagnosis.why,
			did: diagnosis.did,
			remedy: diagnosis.remedy,
		});
	}
	const harness = errored.filter((cell) => !diagnosed.has(runId(cell)));
	if (harness.length > 0) {
		failures.push(group("harness", harness, ["harness"]));
	}
	const left = failed.filter((cell) => !diagnosed.has(runId(cell)));
	if (left.length > 0) {
		failures.push(group("undiagnosed", left, []));
	}
	return {
		scenario: first.scenario,
		target: first.target,
		passed: cells.filter((cell) => cell.run?.status === "pass").length,
		graded: cells.filter(
			(cell) => cell.run?.status === "pass" || cell.run?.status === "fail",
		).length,
		errored: errored.length,
		firstFailed:
			(failed[0] ?? errored[0]) === undefined
				? null
				: runId((failed[0] ?? errored[0]) as EvalCell),
		failures,
	};
}

function group(
	kind: "harness" | "undiagnosed",
	cells: EvalCell[],
	causes: EvalFailure["causes"],
): EvalFailure {
	return {
		kind,
		runs: sorted(cells),
		check: null,
		causes,
		why: null,
		did: null,
		remedy: null,
	};
}

function sorted(cells: EvalCell[]): string[] {
	return [...cells]
		.sort((first, second) => first.repetition - second.repetition)
		.map(runId);
}

function runId(cell: EvalCell): string {
	return cell.run?.id ?? "";
}

/** The cell id in a run id, `<batch>#<cell>`, as a diagnosis names its runs. */
function cellOf(cell: EvalCell): string {
	const id = runId(cell);
	return id.slice(id.lastIndexOf("#") + 1);
}
