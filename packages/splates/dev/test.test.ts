import { describe, expect, it } from "bun:test";
import { joinedReports, sideBySide } from "./test";

const report = (suite: string) =>
	`<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="bun test" tests="1">\n  <testsuite name="${suite}"></testsuite>\n</testsuites>\n`;

describe("dev test", () => {
	it("joins the reports, putting every run's suites under the first one's root", () => {
		expect(joinedReports([report("server"), report("web")])).toBe(
			`<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="bun test" tests="1">\n  <testsuite name="server"></testsuite>\n\n  <testsuite name="web"></testsuite>\n</testsuites>\n`,
		);
	});

	it("leaves a lone run's joined report as it was", () => {
		expect(joinedReports([report("server")])).toBe(report("server"));
	});

	it("joins none when a run left no report or one cut short", () => {
		expect(joinedReports([report("server"), ""])).toBe("");
		expect(joinedReports([report("server"), report("web").slice(0, -20)])).toBe(
			"",
		);
		expect(joinedReports([])).toBe("");
	});

	it("splits the cores between the halves, three fifths to the page's", () => {
		expect(sideBySide(["server", "page"], 8)).toEqual([3, 5]);
		expect(sideBySide(["server", "page"], 14)).toEqual([6, 8]);
	});

	it("leaves each half a worker on few cores", () => {
		expect(sideBySide(["server", "page"], 2)).toEqual([1, 1]);
	});

	it("runs a lone run, or one on a single core, alone", () => {
		expect(sideBySide(["server"], 8)).toBeNull();
		expect(sideBySide(["server", "page"], 1)).toBeNull();
	});
});
