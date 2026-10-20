import type { Git } from "../git";
import type { FailedTest } from "../tasks";
import type { GateRun, MergeGate } from "./gate";
import { failingCases, timedTests } from "./test-report";

/** Why a failing gate stopped, independent of whether its task eventually lands. */
export type FailureAttribution = "task" | "trunk" | "flake" | "environment";

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
	{ git, gate }: { git: Git; gate: MergeGate },
	run: GateRun,
	{ cwd, task, onto }: { cwd: string; task: string; onto: string },
): Promise<AttributedFailure> {
	const failed = failingCases(run.xml);
	try {
		const environment = (why: string): AttributedFailure => ({
			kind: "environment",
			failed,
			why,
		});
		if (!failed.length) {
			return environment(
				"The gate named no failing test in a usable JUnit report; check the environment and hook output.",
			);
		}
		// A JUnit report does not tell how to invoke an arbitrary runner. Bun's
		// report identifies its runner; guessing for other reports risks a false pass.
		if (
			!/<testsuites\b[^>]*\bname=["']bun test["']/.test(run.xml) ||
			failed.some((test) => !safeFile(test.file))
		) {
			return environment(
				"Selective retests require a Bun JUnit report with repository-relative failing test files.",
			);
		}
		const files = [...new Set(failed.map((test) => test.file as string))];
		const dir = await git.out(cwd, "rev-parse", "--absolute-git-dir");
		const scratch = `${dir}/splates-attribution`;
		const added = await git.run(
			cwd,
			"worktree",
			"add",
			"--detach",
			scratch,
			onto,
		);
		if (added.code !== 0) {
			return environment(
				`Could not create the baseline checkout: ${added.stderr || added.stdout}`,
			);
		}
		let result: AttributedFailure;
		try {
			result = await reproduce(gate, files, failed, { scratch, cwd, task });
		} catch (error) {
			result = environment(`Attribution could not finish: ${String(error)}`);
		}
		const removed = await git.removeWorktree(scratch);
		return removed.code === 0
			? result
			: environment(
					`Could not remove attribution checkout ${scratch}: ${removed.stderr || removed.stdout}`,
				);
	} catch (error) {
		return {
			kind: "environment",
			failed,
			why: `Attribution could not finish: ${String(error)}`,
		};
	}
}

async function reproduce(
	gate: MergeGate,
	files: string[],
	failed: FailedTest[],
	{ scratch, cwd, task }: { scratch: string; cwd: string; task: string },
): Promise<AttributedFailure> {
	const environment = (why: string): AttributedFailure => ({
		kind: "environment",
		failed,
		why,
	});

	const prepared = await gate.prepare(scratch, task);
	if (prepared.exitCode !== 0) {
		return environment(
			`Baseline setup failed: ${prepared.stdout}\n${prepared.stderr}`,
		);
	}
	const baseline = await gate.run(scratch, task, { files });
	if (baseline.exitCode !== 0) {
		return failingCases(baseline.xml).length > 0
			? {
					kind: "trunk",
					failed,
					why: "The failing files also fail without the task on the exact base commit. The merge is held until the gate passes.",
				}
			: environment(
					`Baseline retest failed without naming a test: ${baseline.stdout}\n${baseline.stderr}`,
				);
	}
	if (!ranFiles(baseline, files)) {
		return environment(
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
			: environment(
					`Task retest failed without naming a test: ${repeated.stdout}\n${repeated.stderr}`,
				);
	}
	return ranFiles(repeated, files)
		? {
				kind: "flake",
				failed,
				why: "The failing files passed on the base and then with the task. The full gate must pass again before landing.",
			}
		: environment(
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
