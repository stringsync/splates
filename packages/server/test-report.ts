import type { FailedTest } from "./tasks";

/** One test as a JUnit report timed it. */
export interface TimedTest {
	/** Its describe blocks and its own name, joined as bun prints them: `outer > inner > name`. */
	name: string;
	/** The file it is in, when the report says. */
	file?: string;
	seconds: number;
}

/**
 * Each test in a JUnit XML report with the time it took, as `bun test
 * --reporter=junit`, vitest, jest-junit and pytest write it. The outermost
 * suite is the file or the runner, so only the suites inside it name the
 * test's describe blocks.
 */
export function timedTests(xml: string): TimedTest[] {
	const suites: string[] = [];
	const tests: TimedTest[] = [];
	for (const [, closing, tag = "", attributes = "", empty] of xml.matchAll(
		TAG,
	)) {
		if (closing) {
			if (tag === "testsuite") {
				suites.pop();
			}
			continue;
		}
		const read = attributesOf(attributes);
		if (tag === "testsuite") {
			if (!empty) {
				suites.push(read.name ?? "");
			}
			continue;
		}
		const seconds = Number(read.time);
		if (tag !== "testcase" || read.name === undefined || !(seconds >= 0)) {
			continue;
		}
		tests.push({
			name: [...suites.slice(1), read.name].filter(Boolean).join(" > "),
			...(read.file === undefined ? {} : { file: read.file }),
			seconds,
		});
	}
	return tests;
}

const TAG = /<(\/?)(testsuite|testcase)\b([^>]*?)(\/?)>/g;
const ATTRIBUTE = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function attributesOf(text: string): Record<string, string> {
	const read: Record<string, string> = {};
	for (const [, key = "", double, single] of text.matchAll(ATTRIBUTE)) {
		read[key] = unescaped(double ?? single ?? "");
	}
	return read;
}

function unescaped(text: string): string {
	return text.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (entity, code: string) => {
		if (code.startsWith("#")) {
			const point =
				code[1]?.toLowerCase() === "x"
					? Number.parseInt(code.slice(2), 16)
					: Number.parseInt(code.slice(1), 10);
			return Number.isNaN(point) ? entity : String.fromCodePoint(point);
		}
		return ENTITIES[code] ?? entity;
	});
}

const ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
};

/**
 * The tests a runner reported as failing, each with what it said, which the
 * tail cuts off. Another runner prints none, so the tail alone is what the
 * agent gets.
 */
export function failedTests(output: string): FailedTest[] {
	// bun prints each as a `(fail) name` line well before the summary, with the
	// expect diff or error and its stack just above it.
	const lines = output.split("\n");
	const found = new Map<string, string>();
	let start = 0;
	lines.forEach((line, index) => {
		const name = FAIL_LINE.exec(line)?.[1];
		if (name === undefined) {
			return;
		}
		if (!found.has(name)) {
			found.set(
				name,
				lines
					.slice(Math.max(start, index - MESSAGE_LINES), index)
					.concat(afterFail(lines[index + 1]))
					.join("\n")
					.trim(),
			);
		}
		start = index + 1;
	});
	return [...found].map(([name, message]) => ({ name, message }));
}

// bun prints a timed-out test's only explanation on the line after its name,
// so the lines above it are another test's noise
function afterFail(next: string | undefined): string[] {
	return next !== undefined && /^\s*\^ /.test(next) ? [next.trim()] : [];
}

const FAIL_LINE = /^\s*\(fail\)\s+(.+?)(?:\s+\[[\d.]+ ?m?s\])?\s*$/;

/** The most lines kept of what one failed test said. */
const MESSAGE_LINES = 30;
