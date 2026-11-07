import { expect, test } from "bun:test";
import { logEntries, mergeEntries, timelineFileEntries } from "./timeline.ts";

test("timeline.md rows become entries and pointers to logs are dropped", () => {
	const entries = timelineFileEntries(
		[
			"# Timeline",
			"- 00:00.0 see logs/console.log lines 6-8 (3 lines, 3 errors) in 00:00.0-00:10.0",
			"- 00:00.5 pointer route changed to localhost/login",
			"- 00:02.1 narration: the total jumps",
			"- 01:03.5 pointer paused over button",
			"- 01:04.0 remark: NaN here",
		].join("\n"),
	);
	expect(entries.map((each) => [each.at, each.kind, each.text])).toEqual([
		[0.5, "route", "localhost/login"],
		[2.1, "said", "the total jumps"],
		[63.5, "pointer", "paused over button"],
		[64, "remark", "NaN here"],
	]);
});

test("log lines land in video time and errors are flagged", () => {
	const start = Date.parse("2026-11-06T15:46:00.000Z");
	const entries = logEntries(
		"network.log",
		"2026-11-06T15:46:02.500Z ERROR POST /a 500 8ms\n2026-11-06T15:45:00.000Z INFO early\njunk",
		start,
	);
	expect(entries).toEqual([
		{
			at: 2.5,
			kind: "network",
			text: "POST /a 500 8ms",
			source: "network.log",
			error: true,
		},
	]);
	expect(
		mergeEntries(entries, timelineFileEntries("- 00:01.0 pointer x")).map(
			(each) => each.at,
		),
	).toEqual([1, 2.5]);
});
