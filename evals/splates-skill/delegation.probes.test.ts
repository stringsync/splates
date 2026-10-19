import { expect, it } from "bun:test";
import module from "./delegation.probes";
import { assess, type Event, type Evidence, type Probe } from "./probe";
import { validate } from "./runner";

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
