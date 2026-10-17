import { describe, expect, it } from "bun:test";
import {
	type Assertion,
	assess,
	type Event,
	type Evidence,
	type Match,
	type Probe,
} from "./probe";

describe("focused probe assertions", () => {
	it("requires actual successful execution, never quoted or hypothetical commands", () => {
		expect(grade(required, { events: [event("1", add)] }).status).toBe("pass");
		expect(
			[
				[],
				[event("1", { ...add, exitCode: 1 })],
				[event("1", { ...add, actor: "fixture" })],
				[event("1", { ...add, args: ["add", "another"] })],
			].map(
				(events) =>
					grade(required, {
						events,
						reply:
							"I would run `arbor add sample`.\n```sh\narbor add sample\n```",
					}).status,
			),
		).toEqual(["fail", "fail", "fail", "fail"]);
		expect(
			grade(required, { events: [event("1", add), event("2", add)] }).status,
		).toBe("fail");
	});
	it("forbids observed actions but cannot certify an incomplete trace", () => {
		const forbidden: Assertion = { ...required, min: 0, max: 0 };
		expect(grade(forbidden).status).toBe("pass");
		expect(grade(forbidden, { events: [event("1", add)] }).status).toBe("fail");
		expect(grade(forbidden, { complete: [] }).status).toBe("uncovered");
	});
	it("checks strict order, including early forbidden order and missing endpoints", () => {
		const order: Assertion = {
			id: "order",
			kind: "before",
			first: add,
			second: read,
		};
		expect(
			grade(order, { events: [event("a", add), event("r", read)] }).status,
		).toBe("pass");
		expect(
			[
				[],
				[event("a", add)],
				[event("r", read)],
				[event("r", read), event("a", add)],
				[event("r0", read), event("a", add), event("r1", read)],
			].map((events) => grade(order, { events }).status),
		).toEqual(["fail", "fail", "fail", "fail", "fail"]);
	});
	it("distinguishes CLI emission from agent actions and compares structured payloads", () => {
		const directive: Match = {
			actor: "cli",
			kind: "directive",
			name: "ARBOR RESUME",
			payload: { task: "sample", ids: [1, 2] },
		};
		const assertion: Assertion = {
			id: "emitted",
			kind: "count",
			match: directive,
			min: 1,
		};
		expect(grade(assertion, { events: [event("d", directive)] }).status).toBe(
			"pass",
		);
		expect(
			grade(assertion, {
				events: [event("d", { ...directive, actor: "agent" })],
			}).status,
		).toBe("fail");
		expect(
			grade(assertion, {
				events: [
					event("d", { ...directive, payload: { task: "other", ids: [1, 2] } }),
				],
			}).status,
		).toBe("fail");
		expect(grade(required, { events: [event("d", directive)] }).status).toBe(
			"fail",
		);
	});
	it("distinguishes absent files/tasks from missing observations", () => {
		const assertion: Assertion = {
			id: "gone",
			kind: "state",
			key: "task/sample",
			equals: null,
		};
		expect(grade(assertion, { state: { "task/sample": null } }).status).toBe(
			"pass",
		);
		expect(grade(assertion).status).toBe("uncovered");
		expect(
			grade(assertion, { state: { "task/sample": { status: "working" } } })
				.status,
		).toBe("fail");
	});
	it("uses production report parsing with independently written positive and negative fixtures", () => {
		const assertion: Assertion = {
			id: "report",
			kind: "reply",
			type: "report",
			field: ["report", "task"],
			equals: "sample",
		};
		const reply = "## ✅ Merged sample onto main\n\nThe sample now works.";
		expect(grade(assertion, { reply }).status).toBe("pass");
		expect(
			[
				"",
				`\`\`\`md\n${reply}\n\`\`\``,
				`> ${reply.replaceAll("\n", "\n> ")}`,
				"I would say: ## ✅ Merged sample onto main",
				reply.replace("sample onto", "other onto"),
			].map((text) => grade(assertion, { reply: text }).status),
		).toEqual(["fail", "fail", "fail", "fail", "fail"]);
		expect(
			grade(
				{ ...assertion, field: ["report", "missing"], equals: null },
				{ reply },
			).status,
		).toBe("fail");
		expect(grade(assertion).status).toBe("uncovered");
	});
	it("never promotes gaps, empty assertion sets or incomplete runs to passes", () => {
		expect(assess(probe, evidence).status).toBe("uncovered");
		expect(
			grade({
				id: "judgment",
				kind: "uncovered",
				reason: "Subjective design quality",
			}).status,
		).toBe("uncovered");
		expect(
			(["bound", "infrastructure-error", "unsupported"] as const).map(
				(termination) =>
					grade(required, { termination, events: [event("1", add)] }).status,
			),
		).toEqual(["bound", "infrastructure-error", "unsupported"]);
	});
});

const add: Match = {
	actor: "agent",
	kind: "command",
	name: "arbor",
	args: ["add", "sample"],
	exitCode: 0,
};
const read: Match = { actor: "agent", kind: "read", name: "src/main.ts" };
const event = (id: string, match: Match): Event => ({ args: [], ...match, id });
const probe: Probe = {
	schema: 1,
	id: "start-before-read",
	version: "1",
	aspect: "lifecycle",
	requirement: {
		id: "start-first",
		text: "Start before reading project code",
		source: "SKILL.md#workflow",
	},
	seed: { id: "empty-repo", version: "1", data: {} },
	input: { kind: "message", text: "Fix the sample", origin: "user" },
	tools: ["command", "read"],
	evidence: ["events", "state", "reply"],
	assertions: [],
	stop: { kind: "reply" },
	bounds: { milliseconds: 10000, turns: 1, tokens: 1000 },
	execution: { kind: "agent", skill: "fixture-skill" },
};
const evidence: Evidence = {
	events: [],
	state: {},
	complete: ["events", "state", "reply"],
	termination: "stop",
};
function grade(assertion: Assertion, change: Partial<Evidence> = {}) {
	return assess(
		{ ...probe, assertions: [assertion] },
		{ ...evidence, ...change },
	);
}
const required: Extract<Assertion, { kind: "count" }> = {
	id: "add",
	kind: "count",
	match: add,
	min: 1,
	max: 1,
};
