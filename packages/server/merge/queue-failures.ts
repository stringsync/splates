import { color, type Logger } from "core/log";
import { Duration, SystemWallClock, type WallClock } from "core/time";
import { addedFacts, type Tasks, wording } from "../board";
import type { Event, Journal } from "../records";
import type { FailedTest } from "../tasks";
import type { FailureAttribution } from "./attribution";
import { testKey } from "./quarantine";

const WINDOW = Duration.days(7).ms;
const LATEST = "\n\n### Latest recurrence\n";

/** Keep confirmed failures actionable without making each uncertain gate a task. */
export async function queueFailedTests(
	{
		tasks,
		log,
		journal,
		wall = new SystemWallClock(),
	}: {
		tasks: Tasks;
		log: Logger;
		journal: Journal;
		wall?: WallClock;
	},
	task: string,
	failed: FailedTest[],
	kind: FailureAttribution,
): Promise<void> {
	// Evidence stays on the merge event. Its agent handles its own regressions.
	if (kind === "task" || kind === "inconclusive" || failed.length === 0) {
		return;
	}
	try {
		const now = wall.now();
		const history = await journal.all();
		const known = failureHistory(history, now);
		const listed = await tasks.all();
		const eligible = failed.filter(
			(test) =>
				kind !== "flake" ||
				history.some(
					(event) =>
						event.action === "merge" &&
						event.reason === null &&
						!!event.commit &&
						event.task !== task &&
						event.batch?.includes(task) !== true &&
						event.failureAttribution === "flake" &&
						recent(event, now) &&
						event.failedTests.some((old) => testKey(old) === testKey(test)),
				),
		);
		const pending: FailedTest[] = [];
		const updates = new Map<number, FailedTest[]>();
		for (const test of eligible) {
			const keys = [testKey(test), ...legacyKeys(test.name)];
			const existing = listed.find((item) =>
				known.keys.has(item.id)
					? keys.some((key) => known.keys.get(item.id)?.has(key))
					: keys.includes(item.subject) ||
						((item.subject.startsWith("Tests failed together:") ||
							item.subject.startsWith("Flaky tests together:")) &&
							item.text.includes(
								`- ${test.name}${test.file === undefined ? "" : ` (${test.file})`}\n`,
							)),
			);
			if (existing) {
				updates.set(existing.id, [...(updates.get(existing.id) ?? []), test]);
			} else if (!keys.some((key) => known.closed.has(key))) {
				pending.push(test);
			}
		}
		for (const [id, tests] of updates) {
			const existing = listed.find((item) => item.id === id);
			if (!existing) {
				continue;
			}
			const text =
				existing.text.split(LATEST)[0] + LATEST + detail(task, tests, kind);
			if (text === existing.text) {
				continue;
			}
			const failureKeys = [
				...new Set([...(known.keys.get(id) ?? []), ...tests.map(testKey)]),
			];
			await journal.record(
				"task update",
				task,
				() => existing.update({ text }),
				{
					number: id,
					subject: existing.subject,
					changed: { text: true },
					failureKeys,
				},
			);
		}
		if (!pending.length) {
			return;
		}
		const { subject, text, slug } = wanted(task, pending, kind);
		const add = () => tasks.add(subject, task, { text, slug });
		const added = await journal.record("task add", task, add, (item) => ({
			...addedFacts(item),
			failureKeys: pending.map(testKey),
		}));
		log.info(`  ${color.green("found")} task ${added.id}: ${subject}`);
	} catch (error) {
		log.error(`Could not queue failing-test tasks: ${String(error)}`);
	}
}

function recent(event: Event, now: number): boolean {
	const age = now - Date.parse(event.at);
	return age >= 0 && age <= WINDOW;
}

function legacyKeys(name: string): string[] {
	return [`Tests failed: ${name}`, `Flaky test: ${name}`];
}

/** Follow task ids through starts and closures, including tasks predating failure keys. */
function failureHistory(history: Event[], now: number) {
	const keys = new Map<number, Set<string>>();
	const started = new Map<string, number[]>();
	const closed = new Set<string>();
	const rememberClosed = (ids: number[]) => {
		for (const id of ids) {
			for (const key of keys.get(id) ?? []) {
				closed.add(key);
			}
		}
	};
	for (const event of history) {
		if (event.reason !== null) {
			continue;
		}
		if (event.action === "task add" || event.action === "task update") {
			keys.set(
				event.number,
				new Set([
					...(keys.get(event.number) ?? []),
					...(event.failureKeys ??
						(keys.has(event.number) ? [] : [event.subject])),
				]),
			);
		} else if (event.action === "add" && event.task) {
			started.set(event.task, event.tasks);
		} else if (event.action === "task remove" && recent(event, now)) {
			rememberClosed(event.tasks.map((item) => item.id));
			for (const item of event.tasks) {
				if (!keys.has(item.id)) {
					closed.add(item.subject);
				}
			}
		} else if (
			(event.action === "remove" ||
				(event.action === "merge" && !!event.commit)) &&
			event.task &&
			recent(event, now)
		) {
			rememberClosed(started.get(event.task) ?? []);
		}
	}
	return { keys, closed };
}

function wanted(task: string, failed: FailedTest[], kind: FailureAttribution) {
	const first = failed[0] as FailedTest;
	const grouped = failed.length > 1;
	const subject = grouped
		? `${kind === "flake" ? "Flaky tests" : "Tests failed"} together: ${failed.length} tests (${kind})`
		: `${kind === "flake" ? "Flaky test" : "Tests failed"}: ${first.name}`;
	return {
		...wording(subject, detail(task, failed, kind)),
		slug: grouped
			? `fix-gate-${kind}`
			: failureSlug(first.name, kind === "flake" ? "flaky" : "fix"),
	};
}

function detail(
	task: string,
	failed: FailedTest[],
	kind: FailureAttribution,
): string {
	return [
		`Found while merging \`${task}\`. Attribution: ${kind}.`,
		...(kind === "flake"
			? [
					"",
					"This failure recurred on independent tasks within seven days and passed a full gate rerun. Treat it as flaky: make it deterministic rather than just retrying or loosening it.",
				]
			: []),
		...(failed.length > 1
			? [
					"",
					"These tests failed together. Investigate them as one incident; split out a test only when it reproduces independently.",
				]
			: []),
		"",
		...failed.map(
			(test) =>
				`- ${test.name}${test.file === undefined ? "" : ` (${test.file})`}\n${test.message}`,
		),
	].join("\n");
}

function failureSlug(name: string, prefix: string): string {
	const words = name
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(Boolean)
		.slice(0, 4);
	return `${prefix}-${words.join("-") || "test"}`;
}
