import { describe, expect, it } from "bun:test";
import type { Beat } from "@stringsync/splates-server/stats";
import type { EvalRun } from "./checks";
import type { EndRepo } from "./fixture";
import { IDLE, LANE, PARALLEL, PIVOT_LANE } from "./lanes";
import type { Scenario } from "./scenario";
import type { ToolUse } from "./transcript";

describe("lane checks", () => {
	it("runs: passes a lane set running, and fails one only read", () => {
		expect(
			verdicts(LANE, "runs", [
				run("splates lane show 1"),
				run("splates lane run 1"),
			]),
		).toEqual([true]);
		expect(verdicts(LANE, "runs", [run("splates lane show 1")])).toEqual([
			false,
		]);
	});

	it("names-models: passes #1 and #3 each naming an agent, and fails one bare", () => {
		const named = { assignee: { agent: "claude", model: "sonnet" } };
		expect(
			verdicts(LANE, "names-models", [], {
				end: {
					...END,
					todos: [
						{ id: 1, ...named },
						{ id: 3, ...named },
					],
				},
			}),
		).toEqual([true]);
		expect(
			verdicts(LANE, "names-models", [], {
				end: { ...END, todos: [{ id: 1, ...named }, { id: 3 }] },
			}),
		).toEqual([false]);
	});

	it("links: passes #3 left waiting on #1, and fails it unlinked", () => {
		expect(
			verdicts(LANE, "links", [], {
				end: { ...END, todos: [{ id: 3, blockedBy: [1] }] },
			}),
		).toEqual([true]);
		expect(
			verdicts(LANE, "links", [], {
				end: { ...END, todos: [{ id: 3, blockedBy: [] }] },
			}),
		).toEqual([false]);
	});

	it("leaves-unlinked: fails #3 linked to #1 when they share nothing", () => {
		expect(
			verdicts(PARALLEL, "leaves-unlinked", [], {
				end: { ...END, todos: [{ id: 3, blockedBy: [1] }] },
			}),
		).toEqual([false]);
	});

	it("hands-off: fails a todo handed out with splates add", () => {
		expect(
			verdicts(LANE, "hands-off", [
				run("splates add retry-413 --todo 1 --agent claude --model sonnet"),
			]),
		).toEqual([false]);
	});

	it("hands-off: fails a subagent of its own", () => {
		expect(
			verdicts(LANE, "hands-off", [run("splates lane run 1")], {
				tools: [{ name: "Agent", input: {}, turn: 1 }],
			}),
		).toEqual([false]);
	});

	it("never-waits: fails splates wait, and a sleep", () => {
		expect(
			verdicts(LANE, "never-waits", [run("splates wait retry-413")]),
		).toEqual([false]);
		expect(verdicts(LANE, "never-waits", [run("sleep 30")])).toEqual([false]);
	});

	it("working-report: passes a turn that ends on a Working report", () => {
		expect(
			verdicts(LANE, "working-report", [
				say(
					"## ⏳ Working lanes Upload errors: on retry-413\n\n#### #1 went out.",
				),
			]),
		).toEqual([true]);
	});

	it("asks: passes a question on what becomes of the task, and fails claiming it", () => {
		const ask = say(
			"## ⏳ Working lanes Upload errors: on retry-413\n\n#### retry-413 keeps stopping.\n\n1. What should become of retry-413, which keeps stopping?",
		);
		expect(verdicts(IDLE, "asks", [ask])).toEqual([true]);
		expect(
			verdicts(IDLE, "asks", [run("splates claim retry-413"), ask]),
		).toEqual([false]);
	});

	it("stops-then-drops: passes stopping the agent before removing its task, then dropping #1", () => {
		expect(
			verdicts(PIVOT_LANE, "stops-then-drops", [
				...RESUMED,
				{ kind: "user", text: "Change of plans" },
				run("splates tell retry-413 --stop 'Dropped.'"),
				run("splates remove retry-413 --reason moot"),
				run("splates todo remove 1"),
			]),
		).toEqual([true]);
	});

	it("stops-then-drops: fails removing the task before stopping its agent", () => {
		expect(
			verdicts(PIVOT_LANE, "stops-then-drops", [
				...RESUMED,
				{ kind: "user", text: "Change of plans" },
				run("splates remove retry-413 --reason moot"),
				run("splates tell retry-413 --stop 'Dropped.'"),
				run("splates todo remove 1"),
			]),
		).toEqual([false]);
	});

	it("keeps-going: passes #3 kept naming an agent, and fails it dropped", () => {
		expect(
			verdicts(PIVOT_LANE, "keeps-going", [], {
				end: { ...END, todos: [{ id: 3, assignee: { agent: "claude" } }] },
			}),
		).toEqual([true]);
		expect(verdicts(PIVOT_LANE, "keeps-going", [])).toEqual([false]);
	});
});

/** A first turn that resumed the lane and handed nothing out. */
const RESUMED: Beat[] = [
	run("splates show retry-413"),
	run("splates lane run 1"),
];

const END: EndRepo = {
	landed: [],
	tasks: [],
	todos: [],
	lanes: [],
	main: [],
};

function verdicts(
	scenario: Scenario,
	id: string,
	beats: Beat[],
	{ end = END, tools = [] }: { end?: EndRepo; tools?: ToolUse[] } = {},
): boolean[] {
	const check = scenario.checks.find((each) => each.id === id);
	const log: EvalRun["log"] = {
		transcript: {
			beats: [{ kind: "user", text: scenario.turns[0] ?? "" }, ...beats],
		},
		tools,
		text: "",
		usage: [],
	};
	return (check?.judge({ log, end }) ?? []).map((each) => each.ok);
}

function run(command: string): Beat {
	return { kind: "run", command, output: "", ok: true };
}

function say(text: string): Beat {
	return { kind: "say", text };
}
