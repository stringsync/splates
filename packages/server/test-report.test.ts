import { describe, expect, it } from "bun:test";
import { timedTests } from "./test-report";

describe("timedTests", () => {
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
});
