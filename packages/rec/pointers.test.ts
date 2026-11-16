import { describe, expect, test } from "bun:test";
import { logPointers, renderTimeline } from "./timeline";

const START = Date.parse("2026-11-03T12:00:00.000Z");

describe("timeline pointers", () => {
	test("windows of log lines point at line numbers and count errors", () => {
		const log = [
			"2026-11-03T11:59:00.000Z INFO  before the recording",
			"2026-11-03T12:00:01.000Z INFO  a",
			"2026-11-03T12:00:02.000Z ERROR b",
			"2026-11-03T12:00:25.000Z EXCEPTION c",
			"",
		].join("\n");
		const pointers = logPointers("logs/console.log", log, START);
		expect(pointers.map((pointer) => pointer.at)).toEqual([0, 20]);
		expect(pointers[0]?.text).toBe(
			"logs/console.log lines 2-3 (2 lines, 1 errors) in 00:00.0-00:10.0",
		);
		expect(pointers[1]?.text).toContain("lines 4 (1 lines, 1 errors)");
	});

	test("the timeline merges narration and pointers by time, without copying log text", () => {
		const out = renderTimeline(
			{
				version: 1,
				model: "whisper-1",
				prompt: "",
				startedAt: START,
				text: "",
				words: [],
				utterances: [{ start: 15, end: 16, text: "it broke", words: [] }],
			},
			[{ at: 10, text: "logs/network.log lines 1-2 (2 lines)" }],
		);
		expect(out).toContain(
			"- 00:10.0 see logs/network.log lines 1-2 (2 lines)\n- 00:15.0 narration: it broke",
		);
	});
});
