import { describe, expect, it } from "bun:test";
import { failedTests, failingCases, timedTests } from "./test-report";

describe("test reports", () => {
	it("names each test by its describe blocks, as bun writes them", () => {
		const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="bun test" tests="2" time="0.4">
  <testsuite name="a.test.ts" file="a.test.ts" tests="2" time="0.35">
    <testsuite name="outer &quot;q&quot; &amp; &lt;x&gt;" file="a.test.ts" line="2" time="0">
      <testsuite name="inner" file="a.test.ts" line="2" time="0.051">
        <testcase name="slow one" classname="inner &gt; outer" time="0.051617" file="a.test.ts" line="3" />
      </testsuite>
    </testsuite>
    <testcase name="bad" classname="" time="0.3" file="a.test.ts" line="4">
      <failure type="Error" message="x">Error: x&#10;</failure>
    </testcase>
  </testsuite>
</testsuites>`;

		expect(timedTests(xml)).toEqual([
			{
				name: 'outer "q" & <x> > inner > slow one',
				file: "a.test.ts",
				seconds: 0.051617,
			},
			{ name: "bad", file: "a.test.ts", seconds: 0.3 },
		]);
	});

	it("reads a report whose suites are the files, as vitest and pytest write them", () => {
		const xml = `<testsuites><testsuite name="pytest"><testcase classname="tests.test_x" name='test_y' time="2.5"/></testsuite></testsuites>`;

		expect(timedTests(xml)).toEqual([{ name: "test_y", seconds: 2.5 }]);
	});

	it("skips a test with no time, and reads nothing from what is not a report", () => {
		expect(
			timedTests(`<testsuite name="f"><testcase name="untimed" /></testsuite>`),
		).toEqual([]);
		expect(timedTests("not xml")).toEqual([]);
	});

	it("reads failures, errors, inherited files, and XML escapes", () => {
		expect(
			failingCases(
				`<testsuites name="bun test"><testsuite name="a.test.ts" file="a.test.ts"><testsuite name="outer"><testcase name="passes"/><testcase name="fails &amp; errors"><failure message="expected &lt;ok&gt;"/></testcase><testcase name="crash"><error><![CDATA[boom <x>]]></error></testcase></testsuite></testsuite></testsuites>`,
			),
		).toEqual([
			{
				name: "outer > fails & errors",
				file: "a.test.ts",
				message: "expected <ok>",
			},
			{ name: "outer > crash", file: "a.test.ts", message: "boom <x>" },
		]);
	});
	it("locates timed cases whose file is inherited from a suite", () => {
		expect(
			timedTests(
				'<testsuites><testsuite file="a&amp;b.test.ts"><testcase name="passed" time="0.1"/></testsuite></testsuites>',
			),
		).toEqual([{ name: "passed", file: "a&b.test.ts", seconds: 0.1 }]);
	});

	it("rejects truncated reports", () => {
		expect(failingCases('<testsuite><testcase name="bad"><failure/>')).toEqual(
			[],
		);
	});

	it("names an error thrown between tests for the file it came from, with what it said", () => {
		const output = [
			"packages/a/b.test.ts:",
			"(pass) b > fine [1.00ms]",
			"",
			"# Unhandled error between tests",
			"-------------------------------",
			"19 | 		await fs.rename(tmp, path);",
			"                ^",
			"ENOENT: no such file or directory, rename 'x.tmp' -> 'x'",
			"-------------------------------",
			"",
			" 1 pass",
			" 0 fail",
			" 1 error",
		].join("\n");

		expect(failedTests(output)).toEqual([
			{
				name: "Unhandled error between tests in packages/a/b.test.ts",
				message: [
					"19 | 		await fs.rename(tmp, path);",
					"                ^",
					"ENOENT: no such file or directory, rename 'x.tmp' -> 'x'",
				].join("\n"),
			},
		]);
	});

	it("names one with no file before it by itself, beside a failed test", () => {
		const output = [
			"# Unhandled error between tests",
			"-------------------------------",
			"ReferenceError: x is not defined",
			"-------------------------------",
			"Expected: 1",
			"(fail) a > b [1.2ms]",
		].join("\n");

		expect(failedTests(output)).toEqual([
			{
				name: "Unhandled error between tests",
				message: "ReferenceError: x is not defined",
			},
			{
				name: "a > b",
				message: "Expected: 1",
			},
		]);
	});
});
