import { fail } from "../exit";
import type { Git } from "../git";
import type { Facts } from "../records";
import type { FailedTest, WorktreeService } from "../tasks";
import { chargeLine } from "./charge";
import { landedLines, landedSince } from "./landed";
import type { MergeState } from "./merge-state";
import { failedTests } from "./test-report";

const TAIL_LINES = 40;
/** How many lines of a failing gate's output a refusal shows whole. */
const SHOWN_LINES = 400;
/** How many characters of them, since one line can run long. */
const SHOWN_CHARS = 40_000;
/** The lines kept from the start of an output too long to show whole. */
const HEAD_LINES = 100;

/** What a failing gate said and ran on, as `refuseTestsFailed` reports it. */
export interface GateFailed {
	task: string;
	branch: string;
	base: string;
	/** The task's checkout, where the failing files can be run. */
	cwd: string;
	/** The gate's command, named in the refusal. */
	command: string;
	/** The gate's whole output, printed whole up to a cap. */
	output: string;
	/** The file holding all of it, when the gate printed to one. */
	log?: string;
	exitCode: number;
	/** The failing cases of its JUnit report, for what landed since. */
	failing: FailedTest[];
	/** The base commit the branch sits on now, which it was tested against alone. */
	onto: string;
	/** The commit the task was gated on: `onto`, or the stack under it in a batch. */
	rebasedOnto: string;
	/** The branch's tip as gated. */
	testedHead: string;
	/** The base the branch sat on before the merge rebased it, if known. */
	lastBase: string | null;
	/** The tasks it was gated with, leader first, and the stack commit to reproduce on. */
	batch?: { tasks: string[]; at: string };
}

/**
 * Refuses a merge whose gate failed: records the failure on the task,
 * spending an attempt only where the charge rules say, names what landed on
 * the base meanwhile, and ends in `tests_failed` with the failing tests and
 * what to do last, where an agent reading the end finds them.
 */
export async function refuseTestsFailed(
	{
		git,
		service,
		state,
	}: { git: Git; service: WorktreeService; state: MergeState },
	failed: GateFailed,
	facts: Partial<Facts["merge"]>,
): Promise<never> {
	const { task, branch, base, output } = failed;
	const printed = failedTests(output);
	const taskFailed = facts.failureAttribution === "task";
	const spent = await state.recordTestsFailed(
		taskFailed,
		failed.rebasedOnto,
		facts.failedTests ?? [],
	);
	facts.attemptsLeft = (facts.attemptsLeft ?? 1) - (spent.charged ? 1 : 0);
	const named = facts.failedTests?.length ? facts.failedTests : printed;
	if (named.length === 0) {
		facts.output = said(output);
	}
	const landed = await landedSince(
		{ git, finished: service.finished },
		{
			cwd: failed.cwd,
			from: failed.lastBase,
			to: failed.onto,
			head: failed.testedHead,
			failing: failed.failing,
		},
	);
	if (landed !== null) {
		facts.landed = landed;
	}
	const batch = failed.batch;
	// The failing tests and what to do come last, after the gate's own
	// output: an agent that reads only the end of this, as through `tail`,
	// would otherwise see the runner's summary alone, and merge again just
	// to read it, which lands the task whenever a flaky test passes.
	fail(
		"tests_failed",
		[
			shown(output, failed.log),
			"",
			`\`${failed.command}\` failed after rebasing onto ${base} (exit ${failed.exitCode}).`,
			...(batch === undefined
				? [
						`${base} is untouched and ${branch} is now rebased onto ${base}@${failed.onto.slice(0, 8)}, the commit it was tested against; run the failing files there (\`bun test <paths>\`) before changing anything.`,
					]
				: [
						`It was gated in one batch with ${batch.tasks.filter((each) => each !== task).join(", ")}, stacked on ${base}@${failed.onto.slice(0, 8)}${taskFailed ? `, and the failing files first fail with ${task}'s commits in the stack` : ""}.`,
						`${base} is untouched and ${branch} is now rebased onto ${base}@${failed.onto.slice(0, 8)} alone; run the failing files there (\`bun test <paths>\`) before changing anything${taskFailed ? `, and on the stack as gated (\`git worktree add --detach <dir> ${batch.at.slice(0, 8)}\`) when they pass alone` : ""}.`,
					]),
			...(failed.log === undefined
				? []
				: [
						`The gate's complete output is in ${failed.log}: read it before asking the user to run the gate themselves.`,
					]),
			chargeLine({
				...spent,
				taskFailed,
				base,
				onto: failed.rebasedOnto,
				attribution: facts.failureAttribution,
			}),
			"",
			...(named.length > 0
				? [
						`Failing tests (${named.length}):`,
						...named.flatMap((each) => [
							each.name,
							...(each.message === "" ? [] : [indent(each.message)]),
						]),
						"",
					]
				: []),
			...landedLines(base, landed),
			"Fix what broke, or run a test you think flaky on its own to check, then merge again. Never merge only to read this again: a merge whose gate passes lands, with the message it was given.",
		].join("\n"),
		{
			task,
			exitCode: failed.exitCode,
			failedTests: named,
			attribution: facts.failureAttribution,
		},
	);
}

/** How many lines of git's or the gate's output a merge event keeps. */
const SAID_LINES = 40;
/** How many characters of them, since one line can run long. */
const SAID_CHARS = 4000;

/**
 * The end of what git or the gate printed, bounded for the merge event,
 * which the page opens to say why a merge was refused.
 */
export function said(output: string): string {
	const end = tail(output, SAID_LINES);
	return end.length > SAID_CHARS ? `…${end.slice(-SAID_CHARS)}` : end;
}

/**
 * What a failing gate printed, whole while it fits the caps. Past them the
 * start and the end stay, since the first error is often the cause, and the
 * cut says how much it left out and where all of it is.
 */
export function shown(output: string, log?: string): string {
	const text = output.trim();
	const lines = text.split("\n");
	if (lines.length <= SHOWN_LINES && text.length <= SHOWN_CHARS) {
		return text;
	}
	const keep = Math.max(1, Math.floor(SHOWN_CHARS / 2));
	const head = lines.slice(0, HEAD_LINES).join("\n").slice(0, keep);
	const end = lines.slice(-(SHOWN_LINES - HEAD_LINES)).join("\n");
	const rest = end.length > keep ? end.slice(-keep) : end;
	const omitted = Math.max(
		0,
		lines.length - HEAD_LINES - (SHOWN_LINES - HEAD_LINES),
	);
	return [
		head,
		`… ${omitted} lines omitted${log === undefined ? "" : `; the complete output is in ${log}`} …`,
		rest,
	].join("\n");
}

export function tail(output: string, lines = TAIL_LINES): string {
	return output.trim().split("\n").slice(-lines).join("\n");
}

export function indent(text: string): string {
	return text
		.split("\n")
		.map((line) => `    ${line}`)
		.join("\n");
}
