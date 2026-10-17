import { expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	HEARTBEAT,
	handoffReference,
	handoffToReference,
	reportReference,
	// biome-ignore lint/style/noRestrictedImports: test production directive constructors without adding shared exports.
} from "../../packages/arbor/prompts";
import module from "./delegation.probes";
import { assess, type Event, type Evidence, type Probe } from "./probe";
import { cliAdapter } from "./probe-adapters";
import { runProbes, validate } from "./runner";

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
	expect(handoffReference("child")).toBe("[ARBOR HANDOFF child]");
	expect(handoffToReference({ agent: "fake", model: "small" })).toBe(
		"[ARBOR HANDOFF TO fake small]",
	);
	expect(handoffToReference({ agent: "fake" })).toBe("[ARBOR HANDOFF TO fake]");
	expect(reportReference("child")).toBe("[ARBOR REPORT child]");
	expect(HEARTBEAT).toBe("[ARBOR HEARTBEAT]");
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
