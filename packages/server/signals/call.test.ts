import { describe, expect, test } from "bun:test";
import {
	callOf,
	checkSignalFunctions,
	STANDARD_SIGNAL_FUNCTIONS,
} from "./call";

const signalFunctions = {
	...STANDARD_SIGNAL_FUNCTIONS,
	...checkSignalFunctions({
		"aws.stack-ready": {
			description: "stack up",
			args: { stack: { type: "string", description: "name" } },
			main: "stack",
		},
	}),
};

describe("callOf", () => {
	test("a bare name is its own identity", () => {
		expect(callOf("mdom/released", signalFunctions).canonical).toBe(
			"mdom.released",
		);
	});
	test("a plain value maps to the main field and spellings agree", () => {
		const spelled = callOf('clock.in("2 Days")', signalFunctions).canonical;
		expect(callOf(spelled, signalFunctions).args.after).toBe("172800s");
		expect(
			callOf("clock.in({ after: '2  days', })", signalFunctions).canonical,
		).toBe(spelled);
	});
	test("keys are sorted and arguments may span lines with comments", () => {
		const every = callOf(
			`clock.interval({\n // zone\n tz: "UTC", interval: "1d" })`,
			signalFunctions,
		);
		expect(every.canonical).toBe(
			'clock.interval({ interval: "86400s", tz: "UTC" })',
		);
	});
	test("a ) inside a string does not end the call", () => {
		expect(callOf('x.y({ a: ")" })', signalFunctions).args).toEqual({ a: ")" });
	});
	test("refuses unknown fields, missing fields, wrong types and unknown reserved signal functions", () => {
		expect(() =>
			callOf("aws.stack-ready({ nope: 1 })", signalFunctions),
		).toThrow();
		expect(() => callOf("aws.stack-ready", signalFunctions)).toThrow();
		expect(() => callOf('task.done("x")', signalFunctions)).toThrow();
		expect(() => callOf("clock.soon(1)", signalFunctions)).toThrow();
		expect(() => callOf("clock.in(1", signalFunctions)).toThrow();
	});
	test("quota signal functions accept bare calls for any agent or narrow by agent and window", () => {
		expect(callOf("quota.unused", signalFunctions).canonical).toBe(
			"quota.unused",
		);
		expect(callOf('quota.unused("claude")', signalFunctions).canonical).toBe(
			'quota.unused({ agent: "claude" })',
		);
		expect(
			callOf(
				'quota.unused({ agent: "claude", window: "seven_day" })',
				signalFunctions,
			).canonical,
		).toBe('quota.unused({ agent: "claude", window: "seven_day" })');
	});
	test("rejects declared signal functions on reserved prefixes", () => {
		expect(() =>
			checkSignalFunctions({ "clock.x": { description: "d" } }),
		).toThrow();
	});
});
