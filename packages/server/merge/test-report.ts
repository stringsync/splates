import type { FailedTest } from "../tasks";

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
	const suiteFiles: Array<string | undefined> = [];
	const tests: TimedTest[] = [];
	for (const [, closing, tag = "", attributes = "", empty] of xml.matchAll(
		TAG,
	)) {
		if (closing) {
			if (tag === "testsuite") {
				suites.pop();
				suiteFiles.pop();
			}
			continue;
		}
		const read = attributesOf(attributes);
		if (tag === "testsuite") {
			if (!empty) {
				suites.push(read.name ?? "");
				suiteFiles.push(read.file);
			}
			continue;
		}
		const seconds = Number(read.time);
		if (tag !== "testcase" || read.name === undefined || !(seconds >= 0)) {
			continue;
		}
		const file = read.file ?? suiteFiles.findLast((file) => file !== undefined);
		tests.push({
			name: [...suites.slice(1), read.name].filter(Boolean).join(" > "),
			...(file === undefined ? {} : { file }),
			seconds,
		});
	}
	return tests;
}

/** A failed JUnit case; file is absent when the runner did not locate it. */
export interface FailingCase extends FailedTest {
	file?: string;
}

/** Failures and errors in a complete JUnit report, including inherited suite files. */
export function failingCases(xml: string): FailingCase[] {
	if (!/<\/(?:testsuites|testsuite)>\s*$/.test(xml.trim())) {
		return [];
	}
	const suites: Array<{ name: string; file?: string }> = [];
	const failed: FailingCase[] = [];
	let current: { name: string; file?: string } | null = null;
	for (const match of xml.matchAll(
		/<(\/?)(testsuite|testcase|failure|error)\b([^>]*?)(\/?)>/g,
	)) {
		const [, closing, tag, attributes = "", empty] = match;
		const read = attributesOf(attributes);
		if (tag === "testsuite") {
			if (closing) {
				suites.pop();
			} else if (!empty) {
				suites.push({ name: read.name ?? "", file: read.file });
			}
		} else if (tag === "testcase") {
			current =
				closing || empty
					? null
					: {
							name: [
								...suites.slice(1).map((suite) => suite.name),
								read.name ?? "",
							]
								.filter(Boolean)
								.join(" > "),
							file:
								read.file ??
								suites.findLast((suite) => suite.file !== undefined)?.file,
						};
		} else if (!closing && current) {
			const end = xml.indexOf(
				`</${tag}>`,
				(match.index ?? 0) + match[0].length,
			);
			const body =
				!empty && end >= 0
					? xml.slice((match.index ?? 0) + match[0].length, end)
					: "";
			failed.push({
				...current,
				message:
					unescaped(body.replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, "$1")).trim() ||
					read.message ||
					"",
			});
			current = null;
		}
	}
	return failed;
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
			return Number.isNaN(point) || point < 0 || point > 0x10ffff
				? entity
				: String.fromCodePoint(point);
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
 * agent gets. An error thrown between tests fails the run with no test
 * failing, so it is named for the file it came from.
 */
export function failedTests(output: string): FailedTest[] {
	// bun prints each as a `(fail) name` line, `✗ name` since 1.4, well before
	// the summary, with the expect diff or error and its stack just above it.
	// A gate that forces color wraps every part of the line in escapes.
	const lines = output.replace(ANSI, "").split("\n");
	const found = new Map<string, string>();
	let start = 0;
	let file: string | undefined;
	lines.forEach((line, index) => {
		const header = FILE_LINE.exec(line)?.[1];
		if (header !== undefined) {
			file = header;
			// a file's output starts over here: nothing above is its own
			start = index + 1;
		}
		if (UNHANDLED_LINE.test(line)) {
			const name = `${UNHANDLED}${file === undefined ? "" : ` in ${file}`}`;
			const error = unhandled(lines.slice(index + 1));
			if (!found.has(name)) {
				found.set(name, error.message);
			}
			// what it said is no test's message
			start = index + 1 + error.lines;
			return;
		}
		const name = FAIL_LINE.exec(line)?.[1];
		if (name === undefined) {
			return;
		}
		if (!found.has(name)) {
			found.set(
				name,
				lines
					.slice(Math.max(start, index - MESSAGE_LINES), index)
					.filter((above) => !PASS_LINE.test(above))
					.concat(afterFail(lines[index + 1]))
					.join("\n")
					.trim(),
			);
		}
		start = index + 1;
	});
	return [...found].map(([name, message]) => ({ name, message }));
}

// bun frames what an unhandled error said between two rules of dashes
function unhandled(after: string[]): { message: string; lines: number } {
	const opens = RULE_LINE.test(after[0] ?? "") ? 1 : 0;
	const closes = after.findIndex(
		(line, index) => index >= opens && RULE_LINE.test(line),
	);
	const end = closes === -1 ? opens + MESSAGE_LINES : closes;
	return {
		message: after
			.slice(opens, Math.min(end, opens + MESSAGE_LINES))
			.join("\n")
			.trim(),
		lines: closes === -1 ? opens : closes + 1,
	};
}

// bun prints a timed-out test's only explanation on the line after its name,
// so the lines above it are another test's noise
function afterFail(next: string | undefined): string[] {
	return next !== undefined && /^\s*\^ /.test(next) ? [next.trim()] : [];
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: color escapes
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;
const UNHANDLED = "Unhandled error between tests";
const UNHANDLED_LINE = /^\s*# Unhandled error between tests\s*$/;
const RULE_LINE = /^-{3,}\s*$/;
// bun heads each file's output with its path
const FILE_LINE = /^(\S+\.(?:test|spec)\.[cm]?[jt]sx?):\s*$/;
// a passing test's line is never part of a failure's message
const PASS_LINE = /^\s*(?:\(pass\)|✓)\s/;
const FAIL_LINE = /^\s*(?:\(fail\)|✗)\s+(.+?)(?:\s+\[[\d.]+ ?m?s\])?\s*$/;

/** The most lines kept of what one failed test said. */
const MESSAGE_LINES = 30;
