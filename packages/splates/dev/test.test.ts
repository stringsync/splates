import { describe, expect, it } from "bun:test";
import { FakePs } from "webappwiz/system/testing";
import { joinedReports, test as runTests } from "./test";

const report = (suite: string) =>
	`<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="bun test" tests="1">\n  <testsuite name="${suite}"></testsuite>\n</testsuites>\n`;

describe("joinedReports", () => {
	it("refuses --local outside a runner or the merge gate before starting tests", async () => {
		await expect(runTests({ local: true, ps: new FakePs() })).rejects.toThrow(
			"--local is only for a runner or the merge gate",
		);
	});

	it("puts every run's suites under the first one's root", () => {
		expect(joinedReports([report("server"), report("web")])).toBe(
			`<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="bun test" tests="1">\n  <testsuite name="server"></testsuite>\n\n  <testsuite name="web"></testsuite>\n</testsuites>\n`,
		);
	});

	it("leaves a lone run's report as it was", () => {
		expect(joinedReports([report("server")])).toBe(report("server"));
	});

	it("is empty when a run left no report or one cut short", () => {
		expect(joinedReports([report("server"), ""])).toBe("");
		expect(joinedReports([report("server"), report("web").slice(0, -20)])).toBe(
			"",
		);
		expect(joinedReports([])).toBe("");
	});
});
