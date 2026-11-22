import { describe, expect, test } from "bun:test";
import { waitIn, waitOutcome } from "./wait-request";

describe("waitIn", () => {
	test("reads a task wait off the end and strips it", () => {
		expect(waitIn("Queued.\n\n[SPLATES WAIT task ship-chip-clarity]")).toEqual({
			body: "Queued.",
			directive: "[SPLATES WAIT task ship-chip-clarity]",
			wait: { type: "task", task: "ship-chip-clarity" },
		});
	});
	test("reads an idle wait", () => {
		expect(
			waitIn("Heavy run next.\n[SPLATES WAIT machine idle 2m]")?.wait,
		).toEqual({
			type: "idle",
			duration: "2m",
		});
	});
	test("ignores a directive mid-reply", () => {
		expect(waitIn("[SPLATES WAIT task a]\nmore")).toBeNull();
	});
	test("reads the server's reply, null otherwise", () => {
		expect(waitOutcome("[SPLATES WAIT COMPLETE]\n\nMerged.")).toBe("Merged.");
		expect(waitOutcome("hello")).toBeNull();
		expect(waitOutcome(undefined)).toBeNull();
	});
});
