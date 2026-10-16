import { describe, expect, it } from "bun:test";
import type { Beat } from "@webappwiz/arbor/skill-checks";
import type { EvalRun } from "./checks";
import type { EndRepo } from "./fixture";
import { IDLE, LANE, PIVOT_LANE } from "./lanes";
import type { Scenario } from "./scenario";
import type { ToolUse } from "./transcript";

describe("lane checks", () => {
	it("hands-out: passes a lane that hands out only #1", () => {
		expect(
			verdicts(LANE, "hands-out", [
				run("arbor lane show 1"),
				run("arbor add retry-413 --todo 1 --agent claude --model sonnet"),
			]),
		).toEqual([true]);
	});

	it("hands-out: fails one that also hands out #3, which waits on #1", () => {
		expect(
			verdicts(LANE, "hands-out", [
				run("arbor add retry-413 --todo 1 --agent claude"),
				run("arbor add client-errors --todo 3 --agent claude"),
			]),
		).toEqual([false]);
	});

	it("hands-off: fails a todo taken without --agent, to do itself", () => {
		expect(
			verdicts(LANE, "hands-off", [run("arbor add retry-413 --todo 1")]),
		).toEqual([false]);
	});

	it("hands-off: fails a subagent of its own", () => {
		expect(
			verdicts(
				LANE,
				"hands-off",
				[run("arbor add retry-413 --todo 1 --agent claude")],
				{ tools: [{ name: "Agent", input: {}, turn: 1 }] },
			),
		).toEqual([false]);
	});

	it("never-waits: fails arbor wait, and a sleep", () => {
		expect(
			verdicts(LANE, "never-waits", [run("arbor wait retry-413")]),
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

	it("tells: passes telling the idle agent to carry on, and fails claiming its task", () => {
		expect(
			verdicts(IDLE, "tells", [run("arbor tell retry-413 'Carry on.'")]),
		).toEqual([true]);
		expect(
			verdicts(IDLE, "tells", [
				run("arbor tell retry-413 'Carry on.'"),
				run("arbor claim retry-413"),
			]),
		).toEqual([false]);
	});

	it("stops-then-drops: passes stopping the agent before removing its task, then dropping #1", () => {
		expect(
			verdicts(PIVOT_LANE, "stops-then-drops", [
				...RESUMED,
				{ kind: "user", text: "Change of plans" },
				run("arbor tell retry-413 --stop 'Dropped.'"),
				run("arbor remove retry-413 --reason moot"),
				run("arbor todo remove 1"),
			]),
		).toEqual([true]);
	});

	it("stops-then-drops: fails removing the task before stopping its agent", () => {
		expect(
			verdicts(PIVOT_LANE, "stops-then-drops", [
				...RESUMED,
				{ kind: "user", text: "Change of plans" },
				run("arbor remove retry-413 --reason moot"),
				run("arbor tell retry-413 --stop 'Dropped.'"),
				run("arbor todo remove 1"),
			]),
		).toEqual([false]);
	});

	it("keeps-going: passes handing out #3 once #1 is dropped, with #3 kept", () => {
		expect(
			verdicts(
				PIVOT_LANE,
				"keeps-going",
				[
					...RESUMED,
					{ kind: "user", text: "Change of plans" },
					run("arbor add client-errors --todo 3 --agent claude"),
				],
				{ end: { ...END, todos: [{ id: 3 }] } },
			),
		).toEqual([true]);
	});
});

/** A first turn that resumed the lane and handed nothing out. */
const RESUMED: Beat[] = [run("arbor show retry-413")];

const END: EndRepo = {
	landed: [],
	tasks: [],
	todos: [],
	lanes: [],
	systems: false,
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
			handed: false,
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
