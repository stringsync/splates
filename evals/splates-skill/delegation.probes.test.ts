import { expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	HEARTBEAT,
	handoffReference,
	handoffToReference,
	reportReference,
} from "@stringsync/splates-server/plans";
import module from "./delegation.probes";
import { assess, type Event, type Evidence, type Probe } from "./probe";
import { cliAdapter } from "./probe-adapters";
import { command } from "./probe-sandbox";
import { type Adapter, runProbes, validate } from "./runner";

it("validates independently selectable bounded delegation cases", () => {
	validate(module.probes);
	expect(new Set(module.probes.map((probe) => probe.id)).size).toBe(
		module.probes.length,
	);
	expect(module.probes.every((probe) => probe.aspect === "delegation")).toBe(
		true,
	);
});

// These are synthetic assertion tests, not observed agent adherence.
// scry-ignore simple-test-setup: registry-wide assertion conformance matrix intentionally exercises each declared selector.
for (const probe of module.probes) {
	for (const assertion of probe.assertions) {
		if (assertion.kind === "before") {
			// scry-ignore simple-test-setup: each generated case owns its evidence and declared ordering assertion.
			it(`${probe.id}: order cannot be repaired by a later correction`, () => {
				const only = { ...probe, assertions: [assertion] };
				const first: Event = { id: "first", args: [], ...assertion.first };
				const second: Event = { id: "second", args: [], ...assertion.second };
				const evidence: Evidence = {
					events: [first, second],
					state: {},
					complete: ["events"],
					termination: "stop",
				};
				expect(assess(only, evidence).status).toBe("pass");
				// scry-ignore matchers-over-test-logic: adversarial sequence matrix checks every missing/reversed/repeated endpoint.
				for (const events of [
					[second, first],
					[first],
					[second],
					[first, second, { ...first, id: "late" }],
				]) {
					expect(assess(only, { ...evidence, events }).status).toBe("fail");
				}
				expect(assess(only, { ...evidence, complete: [] }).status).toBe(
					"uncovered",
				);
			});
		}
		if (assertion.kind !== "count") {
			continue;
		}
		// scry-ignore simple-test-setup: each selector needs its own isolated evidence, not shared mutable setup.
		it(`${probe.id}/${assertion.id}: positive, missing/forbidden and incomplete capture`, () => {
			const only: Probe = { ...probe, assertions: [assertion] };
			const event: Event = { id: "synthetic", args: [], ...assertion.match };
			const evidence: Evidence = {
				events: assertion.min ? [event] : [],
				state: {},
				complete: ["events"],
				termination: "stop",
			};
			expect(assess(only, evidence).status).toBe("pass");
			expect(
				assess(only, {
					...evidence,
					events: assertion.min ? [] : [{ ...event, exitCode: 1 }],
				}).status,
			).toBe("fail");
			expect(assess(only, { ...evidence, complete: [] }).status).toBe(
				"uncovered",
			);
			// scry-ignore matchers-over-test-logic: only required-success selectors should reject failed or fixture actions.
			if (assertion.min) {
				expect(
					assess(only, {
						...evidence,
						events: [{ ...event, actor: "fixture" }],
					}).status,
				).toBe("fail");
				expect(
					assess(only, { ...evidence, events: [{ ...event, exitCode: 1 }] })
						.status,
				).toBe("fail");
			}
		});
	}
}

it("checks production directive formatting separately from delivery or agent reaction", () => {
	expect(handoffReference("child")).toBe("[SPLATES HANDOFF child]");
	expect(handoffToReference({ agent: "fake", model: "small" })).toBe(
		"[SPLATES HANDOFF TO fake small]",
	);
	expect(handoffToReference({ agent: "fake" })).toBe(
		"[SPLATES HANDOFF TO fake]",
	);
	expect(reportReference("child")).toBe("[SPLATES REPORT child]");
	expect(HEARTBEAT).toBe("[SPLATES HEARTBEAT]");
});

it("executes actual isolated no-dev relay refusal without starting an agent", async () => {
	const directory = await mkdtemp(join(tmpdir(), "delegation-probes-"));
	try {
		const results = await runProbes(
			{
				...module,
				probes: module.probes.filter((probe) => probe.execution.kind === "cli"),
			},
			[{ adapter: cliAdapter, model: null }],
			{
				directory,
				parallel: 1,
				reps: 1,
				skillHash: "free-fixture",
				cliHash: "local",
				reproduction: [],
			},
		);
		const result = results[0];
		expect(
			result?.run.evidence.detail ?? result?.run.evidence.termination,
		).toBe("stop");
		const event = result?.run.evidence.events.find(
			(event) => event.actor === "cli",
		);
		expect(event?.exitCode).toBe(1);
		expect(JSON.stringify(event?.payload)).toContain("--relay needs");
		expect(result?.result.status).toBe("uncovered");
		expect(result?.run.evidence.complete).not.toContain("events");
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}, 30000);

// scry-ignore simple-test-setup: this test alone owns the base/isolation state matrix; no other test shares it.
it("rejects a child on trunk or in the parent tree and preserves missing state", () => {
	const base = module.probes.find(
		(probe) => probe.id === "delegation/part-base",
	) as Probe;
	const probe = {
		...base,
		assertions: base.assertions.filter(
			(assertion) => assertion.kind === "state",
		),
	};
	const evidence: Evidence = {
		events: [],
		state: { "extra/base": "task/parent", "extra/isolated": true },
		complete: ["state"],
		termination: "stop",
	};
	expect(assess(probe, evidence).status).toBe("pass");
	expect(
		assess(probe, {
			...evidence,
			state: { ...evidence.state, "extra/base": "main" },
		}).status,
	).toBe("fail");
	expect(
		assess(probe, {
			...evidence,
			state: { ...evidence.state, "extra/isolated": false },
		}).status,
	).toBe("fail");
	expect(
		assess(probe, {
			...evidence,
			state: { "extra/base": null, "extra/isolated": null },
		}).status,
	).toBe("fail");
	expect(assess(probe, { ...evidence, state: {} }).status).toBe("uncovered");
});

// What a probe that sizes each request right does, run on the real CLI.
const sized: Record<string, string[][]> = {
	"delegation/auto-question": [],
	"delegation/auto-fits": [["add", "retries", "--goal", "Retry five times"]],
	"delegation/auto-hand-up": [
		["add", "no-413", "--goal", "Stop retrying a 413"],
		[
			"handoff",
			"no-413",
			"--agent",
			"fake",
			"--model",
			"large",
			"--effort",
			"high",
		],
	],
	"delegation/auto-hand-down": [
		["add", "retry-limit", "--goal", "Rename MAX_RETRIES"],
		[
			"handoff",
			"retry-limit",
			"--agent",
			"fake",
			"--model",
			"small",
			"--effort",
			"low",
		],
	],
};
const scripted: Adapter = {
	id: "scripted-auto-probe",
	version: "1",
	config: {},
	tokenBound: true,
	async run(context) {
		for (const args of sized[context.probe.id] ?? []) {
			const result = await command(context, ["splates", ...args], "agent");
			if (result.exitCode !== 0) {
				throw new Error(result.stderr);
			}
		}
		context.reply("Scripted stand-in, not an agent.");
	},
};

it("observes what an Auto probe kept or handed on, from the real task records", async () => {
	const directory = await mkdtemp(join(tmpdir(), "delegation-auto-"));
	try {
		const results = await runProbes(
			{
				...module,
				probes: module.probes.filter((probe) => probe.id in sized),
			},
			[{ adapter: scripted, model: null }],
			{
				directory,
				parallel: 2,
				reps: 1,
				skillHash: "free-fixture",
				cliHash: "local",
				reproduction: [],
			},
		);
		expect(results).toHaveLength(4);
		expect(
			results.map(({ probe, result }) => ({
				probe: probe.id,
				failed: result.verdicts.filter((verdict) => verdict.status === "fail"),
			})),
		).toEqual(Object.keys(sized).map((probe) => ({ probe, failed: [] })));
		const handUp = results.find(
			(run) => run.probe.id === "delegation/auto-hand-up",
		);
		expect(handUp?.run.evidence.state["auto/handoffs"]).toEqual([
			{ agent: "fake", model: "large", effort: "high", relay: false },
		]);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}, 60000);

/** What an Auto probe's observer found, from the task records alone. */
const evidence = (state: Evidence["state"]): Evidence => ({
	events: [],
	state,
	complete: ["state"],
	termination: "stop",
});
const find = (id: string) =>
	module.probes.find((probe) => probe.id === `delegation/${id}`) as Probe;
const handed = (model: string, effort: string | null = null) => [
	{ agent: "fake", model, effort, relay: false },
];

it("fails an Auto probe that hands on what fits, or picks the wrong weight or level", () => {
	expect(
		assess(
			find("auto-fits"),
			evidence({ "auto/tasks": 1, "auto/handoffs": [] }),
		).status,
	).toBe("pass");
	expect(
		assess(
			find("auto-fits"),
			evidence({ "auto/tasks": 1, "auto/handoffs": handed("large") }),
		).status,
	).toBe("fail");
	expect(
		assess(
			find("auto-hand-up"),
			evidence({ "auto/tasks": 1, "auto/handoffs": handed("small") }),
		).status,
	).toBe("fail");
	expect(
		assess(
			find("auto-hand-up"),
			evidence({
				"auto/tasks": 1,
				"auto/handoffs": [
					{ agent: "fake", model: "large", effort: "high", relay: true },
				],
			}),
		).status,
	).toBe("fail");
	expect(
		assess(
			find("auto-hand-up"),
			evidence({ "auto/tasks": 1, "auto/handoffs": handed("large") }),
		).status,
	).toBe("fail");
	// Right, so short of a pass only for the gaps it still leaves.
	expect(
		assess(
			find("auto-hand-up"),
			evidence({ "auto/tasks": 1, "auto/handoffs": handed("large", "high") }),
		).status,
	).toBe("uncovered");
	expect(
		assess(
			find("auto-hand-down"),
			evidence({ "auto/tasks": 1, "auto/handoffs": [] }),
		).status,
	).toBe("fail");
	expect(
		assess(find("auto-question"), evidence({ "auto/tasks": 1 })).status,
	).toBe("fail");
	expect(assess(find("auto-fits"), evidence({})).status).toBe("uncovered");
});
