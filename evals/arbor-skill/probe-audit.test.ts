import { describe, expect, it } from "bun:test";
import {
	type Assertion,
	assess,
	type Event,
	type Evidence,
	type Match,
	type Probe,
} from "./probe";

describe("probe audit: adversarial evidence boundaries", () => {
	it.each([undefined, 0, 1])(
		"forbids an attempt with exit code %s",
		(exitCode) => {
			const result = grade([forbidden], {
				events: [
					event("attempt", {
						...merge,
						...(exitCode === undefined ? {} : { exitCode }),
					}),
				],
			});
			expect(result.status).toBe("fail");
			expect(result.verdicts[0]?.evidence).toEqual(["attempt"]);
		},
	);
	it("documents that success-only prohibitions miss failed attempts", () => {
		// A success-only prohibition is deliberately weaker: authors must omit exitCode.
		expect(
			grade([{ ...forbidden, match: { ...merge, exitCode: 0 } }], {
				events: [event("failed", { ...merge, exitCode: 1 })],
			}).status,
		).toBe("pass");
	});
	it("does not interpret omitted argv as a verb prefix", () => {
		const other = event("show", {
			...merge,
			args: ["show", "sample"],
			exitCode: 0,
		});
		expect(grade([forbidden], { events: [other] }).status).toBe("pass");
		expect(
			grade(
				[
					{
						...forbidden,
						match: { actor: "agent", kind: "command", name: "arbor" },
					},
				],
				{ events: [other] },
			).status,
		).toBe("fail");
		expect(
			grade([forbidden], {
				events: [event("flagged", { ...merge, args: ["merge", "--help"] })],
			}).status,
		).toBe("pass");
	});
	it("requires all first occurrences before all second occurrences, without deduplicating", () => {
		expect(
			grade([order], {
				events: [
					event("m1", merge),
					event("m2", merge),
					event("r1", read),
					event("r2", read),
				],
			}).status,
		).toBe("pass");
		const result = grade([order], {
			events: [event("m1", merge), event("r1", read), event("m2", merge)],
		});
		expect(result.status).toBe("fail");
		// biome-ignore lint/suspicious/noThenProperty: the public verdict names its second indices then.
		expect(result.verdicts[0]?.actual).toEqual({ first: [0, 2], then: [1] });
		expect(
			grade([{ ...order, second: merge }], { events: [event("same", merge)] })
				.status,
		).toBe("fail");
	});
	it.each([
		["stop", "fail"],
		["bound", "bound"],
		["unsupported", "unsupported"],
		["infrastructure-error", "infrastructure-error"],
	] as const)(
		"preserves diagnostics on %s termination",
		(termination, status) => {
			const result = grade(
				[
					forbidden,
					{
						id: "gap",
						kind: "uncovered",
						reason: "No external service observation",
					},
				],
				{
					termination,
					events: [event("m", merge)],
					detail: "audit detail",
				},
			);
			expect(result).toEqual({
				status,
				detail: "audit detail",
				verdicts: [
					{
						id: "no-merge-attempt",
						status: "fail",
						expected: { min: 0, max: 0 },
						actual: 1,
						evidence: ["m"],
					},
					{
						id: "gap",
						status: "uncovered",
						expected: "No external service observation",
						actual: null,
						evidence: [],
					},
				],
			});
		},
	);
	it("requires completeness independently for every asserted channel", () => {
		const assertions: Assertion[] = [
			forbidden,
			{ id: "state", kind: "state", key: "task", equals: null },
		];
		expect(
			grade(assertions, {
				complete: ["state"],
				state: { task: null },
			}).verdicts.map((verdict) => verdict.status),
		).toEqual(["uncovered", "pass"]);
		expect(
			grade(assertions, {
				complete: ["events"],
				state: { task: null },
			}).verdicts.map((verdict) => verdict.status),
		).toEqual(["pass", "uncovered"]);
	});
	it("does not confuse an inherited observation with captured absence", () => {
		expect(
			grade([{ id: "state", kind: "state", key: "task", equals: null }], {
				state: Object.create({ task: null }),
			}).status,
		).toBe("uncovered");
	});
	it.each(["The change works.", "Coverage now records its limits."])(
		"requires execution evidence behind report prose: %s",
		(body) => {
			const format: Assertion = {
				id: "format",
				kind: "reply",
				type: "report",
				field: ["report", "task"],
				equals: "sample",
			};
			const executed: Assertion = {
				id: "executed",
				kind: "count",
				match: { ...merge, exitCode: 0 },
				min: 1,
			};

			const reply = `## ✅ Merged sample onto main\n\n${body}`;
			expect(grade([format], { reply }).status).toBe("pass");
			expect(grade([format, executed], { reply }).status).toBe("fail");
			expect(
				grade([format, executed], {
					reply,
					events: [event("m", { ...merge, exitCode: 0 })],
				}).status,
			).toBe("pass");
			expect(grade([format], { reply: "" }).status).toBe("fail");
			expect(grade([format]).status).toBe("uncovered");
		},
	);
});

// Synthetic grader fixtures, not executed CLI commands or measured agent runs.
const merge: Match = {
	actor: "agent",
	kind: "command",
	name: "arbor",
	args: ["merge"],
};
const read: Match = { actor: "agent", kind: "read", name: "src/main.ts" };
const event = (id: string, match: Match): Event => ({ args: [], ...match, id });
const probe: Probe = {
	schema: 1,
	id: "audit",
	version: "1",
	aspect: "audit",
	requirement: {
		id: "audit-contract",
		text: "Preserve evidence limits",
		source: "PROBES.md",
	},
	seed: { id: "synthetic", version: "1", data: null },
	input: { kind: "message", origin: "user", text: "Audit fixture" },
	tools: [],
	evidence: ["events", "state", "reply"],
	assertions: [],
	stop: { kind: "reply" },
	bounds: { milliseconds: 100, turns: 1, tokens: 100 },
	execution: { kind: "agent", skill: "synthetic" },
};
function grade(assertions: Assertion[], change: Partial<Evidence> = {}) {
	return assess(
		{ ...probe, assertions },
		{
			events: [],
			state: {},
			complete: ["events", "state", "reply"],
			termination: "stop",
			...change,
		},
	);
}
const forbidden: Extract<Assertion, { kind: "count" }> = {
	id: "no-merge-attempt",
	kind: "count",
	match: merge,
	min: 0,
	max: 0,
};
const order: Extract<Assertion, { kind: "before" }> = {
	id: "merge-before-read",
	kind: "before",
	first: merge,
	second: read,
};
