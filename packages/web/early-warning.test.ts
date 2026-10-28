import { describe, expect, it } from "bun:test";
import {
	conflictWarning,
	earlyWarning,
} from "@stringsync/splates-server/server/browser";
import { overlapWarnings } from "@stringsync/splates-server/tasks";
import { earlyWarningOf, warningLines } from "./early-warning";

describe("splates server's early warnings", () => {
	it("reads a conflict back from the words the server sends", () => {
		const text = earlyWarning(
			"events-log",
			conflictWarning("main", ["state.ts", "merge.ts"]),
		);

		expect(earlyWarningOf(text)).toEqual({
			kind: "conflict",
			base: "main",
			files: ["state.ts", "merge.ts"],
		});
	});

	it("reads each overlap back from the words the server sends", () => {
		const words = overlapWarnings(
			[
				{ task: "events-log", files: ["a.ts"] },
				{ task: "events-look", files: ["a.ts", "b.ts"] },
				{ task: "mine", files: ["a.ts", "b.ts"] },
			],
			"mine",
			"",
			["a.ts", "b.ts"],
		).join("\n");

		expect(earlyWarningOf(earlyWarning("mine", words))).toEqual({
			kind: "overlap",
			overlaps: [
				{ task: "events-log", files: ["a.ts"] },
				{ task: "events-look", files: ["a.ts", "b.ts"] },
			],
		});
	});

	it("leaves any other message, a reworded warning included, as a message", () => {
		expect(earlyWarningOf("merge it")).toBeNull();
		expect(
			earlyWarningOf(earlyWarning("mine", "Something new to watch for.")),
		).toBeNull();
	});

	it("names the base and each file, or past three, their count", () => {
		const title = "the whole warning";
		const [few] = warningLines(
			{ kind: "conflict", base: "main", files: ["a.ts", "b.ts"] },
			null,
			title,
		);
		const [many] = warningLines(
			{ kind: "conflict", base: "main", files: ["a", "b", "c", "d"] },
			null,
			title,
		);

		expect(few).toEqual({
			mark: "conflict",
			words: [
				"Conflict with",
				{ kind: "branch", branch: "main" },
				"in",
				{ kind: "file", path: "a.ts" },
				{ kind: "file", path: "b.ts" },
			],
			at: null,
			title,
		});
		expect(many?.words.at(-1)).toBe("in 4 files");
	});
});
