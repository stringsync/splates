import { describe, expect, it } from "bun:test";
import type { RunLog } from "@splates/server/rigs/browser";
import { RunLogReader } from "./run-log-reader";

describe("RunLogReader", () => {
	it("asks only for the lines after the last it has", async () => {
		const asked: number[] = [];
		const logs: RunLog[] = [
			{ lines: [{ n: 1, text: "one" }], last: 1 },
			{ lines: [{ n: 2, text: "two" }], last: 2 },
		];
		const reader = new RunLogReader(
			{
				runLog: async (_id, after) => {
					asked.push(after);
					return logs.shift() ?? { lines: [], last: 2 };
				},
			},
			"fixture/echo@main",
		);
		reader.watch(10);
		await Bun.sleep(40);
		reader.dispose();
		expect(asked.slice(0, 3)).toEqual([0, 1, 2]);
		expect(reader.lines.map((line) => line.text)).toEqual(["one", "two"]);
	});
});
