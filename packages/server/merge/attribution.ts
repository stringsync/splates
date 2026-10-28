import type { FailedTest } from "../tasks";
import type { GateRun, MergeGate } from "./gate";
import { failingCases, timedTests } from "./test-report";

/**
 * Why a failing gate stopped, independent of whether its task eventually lands.
 * `inconclusive` is a gate no retest could judge (no usable report, or a retest
 * that did not finish): it shows nothing about the environment.
 */
export type FailureAttribution =
	| "task"
	| "trunk"
	| "flake"
	| "environment"
	| "inconclusive";

export interface AttributedFailure {
	kind: FailureAttribution;
	failed: FailedTest[];
	why: string;
}

/**
 * Attributes one gate failure without moving the task's checkout. A future
 * merge queue can call this against a batch's tip and its exact base commit.
 */
export async function attributeFailure(
	{ gate }: { gate: MergeGate },
	run: GateRun,
	{ cwd, task, onto }: { cwd: string; task: string; onto: string },
): Promise<AttributedFailure> {
	const failed = failingCases(run.xml);
	try {
		const inconclusive = (why: string): AttributedFailure => ({
			kind: "inconclusive",
			failed,
			why,
		});
		if (!failed.length) {
			return inconclusive(
				"The gate named no failing test in a usable JUnit report, so nothing was retested and the failure is not attributed to the environment. Have the gate write a Bun JUnit report to $SPLATES_TEST_REPORT, and read the failing output against your own diff.",
			);
		}
		// A JUnit report does not tell how to invoke an arbitrary runner. Bun's
		// report identifies its runner; guessing for other reports risks a false pass.
		if (
			!/<testsuites\b[^>]*\bname=["']bun test["']/.test(run.xml) ||
			failed.some((test) => !safeFile(test.file))
		) {
			return inconclusive(
				"Selective retests require a Bun JUnit report with repository-relative failing test files.",
			);
		}
		const files = [...new Set(failed.map((test) => test.file as string))];
		return await reproduce(gate, files, failed, { cwd, task, onto });
	} catch (error) {
		return {
			kind: "inconclusive",
			failed,
			why: `Attribution could not finish: ${String(error)}`,
		};
	}
}

async function reproduce(
	gate: MergeGate,
	files: string[],
	failed: FailedTest[],
	{ cwd, task, onto }: { cwd: string; task: string; onto: string },
): Promise<AttributedFailure> {
	const inconclusive = (why: string): AttributedFailure => ({
		kind: "inconclusive",
		failed,
		why,
	});

	// The gate puts the baseline on a runner, or in a checkout of its own here.
	const baseline = await gate.run(cwd, task, { files, at: onto });
	if (baseline.exitCode !== 0) {
		return failingCases(baseline.xml).length > 0
			? {
					kind: "trunk",
					failed,
					why: "The failing files also fail without the task on the exact base commit. The merge is held until the gate passes.",
				}
			: inconclusive(
					`Baseline retest failed without naming a test: ${baseline.stdout}\n${baseline.stderr}`,
				);
	}
	if (!ranFiles(baseline, files)) {
		return inconclusive(
			"The baseline retest did not run every failing file (a test may exist only on the task). Attribution is inconclusive.",
		);
	}
	const repeated = await gate.run(cwd, task, { files });
	if (repeated.exitCode !== 0) {
		return failingCases(repeated.xml).length > 0
			? {
					kind: "task",
					failed,
					why: "The failing files pass on the base and fail again with the task.",
				}
			: inconclusive(
					`Task retest failed without naming a test: ${repeated.stdout}\n${repeated.stderr}`,
				);
	}
	return ranFiles(repeated, files)
		? {
				kind: "flake",
				failed,
				why: "The failing files passed on the base and then with the task. The full gate must pass again before landing.",
			}
		: inconclusive(
				"The task retest did not run every failing file; attribution is inconclusive.",
			);
}

function safeFile(file: string | undefined): boolean {
	return (
		file !== undefined &&
		file !== "" &&
		!file.startsWith("/") &&
		!file.includes("\\") &&
		!file.split("/").includes("..")
	);
}

function ranFiles(run: GateRun, files: string[]): boolean {
	// A zero exit with no cases is not evidence: Bun can be configured to
	// pass when a filter matches nothing. Check coverage before trusting it.
	const seen = new Set(
		timedTests(run.xml).map((test) => test.file?.replace(/^\.\//, "")),
	);
	return (
		/<\/(?:testsuites|testsuite)>\s*$/.test(run.xml.trim()) &&
		files.every((file) => seen.has(file.replace(/^\.\//, "")))
	);
}
