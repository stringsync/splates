import { expect, test } from "bun:test";
import type { Event } from "../records";
import { recentFailedFilesOf } from "./recent-failures";

const NOW = Date.parse("2026-10-23T16:00:00Z");

function merged(at: string, files: Array<string | undefined>): Event {
	return {
		action: "merge",
		at,
		failedTests: files.map((file) => ({
			name: "t",
			message: "",
			...(file ? { file } : {}),
		})),
	} as unknown as Event;
}

test("names each recently failed file once, newest first", () => {
	const entries = [
		merged("2026-10-23T15:00:00Z", ["a.test.ts", undefined]),
		merged("2026-10-23T15:30:00Z", ["b.test.ts", "a.test.ts"]),
	];
	expect(recentFailedFilesOf(entries, NOW)).toEqual(["b.test.ts", "a.test.ts"]);
});

test("leaves out failures older than the window", () => {
	const entries = [merged("2026-10-23T10:00:00Z", ["old.test.ts"])];
	expect(recentFailedFilesOf(entries, NOW)).toEqual([]);
});
