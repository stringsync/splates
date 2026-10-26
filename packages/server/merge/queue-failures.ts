import type { Logger } from "webappwiz/log";
import { addedFacts, type Tasks, wording } from "../board";
import type { Journal } from "../records";
import type { FailedTest } from "../tasks";
import type { FailureAttribution } from "./attribution";

/** Keep a failing test actionable even when the merge is held without an attempt. */
export async function queueFailedTests(
	{ tasks, log, journal }: { tasks: Tasks; log: Logger; journal?: Journal },
	task: string,
	failed: FailedTest[],
	kind: FailureAttribution,
): Promise<void> {
	try {
		const listed = new Set((await tasks.all()).map((each) => each.subject));
		for (const { subject, text, slug } of wanted(task, failed, kind)) {
			if (listed.has(subject)) {
				continue;
			}
			listed.add(subject);
			const add = () => tasks.add(subject, task, { text, slug });
			const added = journal
				? await journal.record("task add", task, add, addedFacts)
				: await add();
			log.info(`  found task ${added.id}: ${subject}`);
		}
	} catch (error) {
		log.error(`Could not queue failing-test tasks: ${String(error)}`);
	}
}

interface Wanted {
	subject: string;
	text: string;
	slug: string;
}

/**
 * A task per failing test, unless several failed together and none is
 * pinned on the code: tests failing at once in a gate blamed on the
 * environment, or as a flake, are one event, as sixteen page tests timing
 * out together in a loaded gate were (2026-10-23), not one bug each, so
 * they make one task to look into.
 */
function wanted(
	task: string,
	failed: FailedTest[],
	kind: FailureAttribution,
): Wanted[] {
	const found = `Found while merging \`${task}\`. Attribution: ${kind}.`;
	if (failed.length > 1 && (kind === "environment" || kind === "flake")) {
		return [
			{
				...wording(
					`Tests failed together in \`${task}\`'s gate: ${failed.length} tests (${kind})`,
					[
						found,
						"",
						`${failed.length} tests failed in one gate run and none was pinned on the code, so they are most likely one event (load, memory, or a run that ended early) rather than ${failed.length} bugs. Look for what they have in common; split out any that fails again on its own.`,
						"",
						...failed.map(
							(test) =>
								`- ${test.name}${test.file === undefined ? "" : ` (${test.file})`}${firstLine(test.message)}`,
						),
					].join("\n"),
				),
				slug: `fix-gate-${kind}`,
			},
		];
	}
	return failed.map((test) => ({
		...wording(
			`Tests failed: ${test.name}`,
			[found, "", test.message].join("\n"),
		),
		slug: failureSlug(test.name),
	}));
}

/** What a test said, its first line, after a colon; nothing when it said nothing. */
function firstLine(message: string): string {
	const line = message
		.split("\n")
		.map((each) => each.trim())
		.find(Boolean);
	return line === undefined ? "" : `: ${line}`;
}

/** A short slug for a failed test's task: `fix-` and the test name's first words. */
function failureSlug(name: string): string {
	const words = name
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(Boolean)
		.slice(0, 4);
	return `fix-${words.join("-") || "test"}`;
}
