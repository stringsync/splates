import { expect, it } from "bun:test";
import { stretches } from "@stringsync/splates-server/plans";
import { decisionDirectives, decisionState, probes } from "./decisions.probes";
import { assess, type Evidence, type Probe } from "./probe";
import { loadModules } from "./probe-cli";
import { validate } from "./runner";

it("validates independently selectable cases and production directive constants", () => {
	validate(probes);
	expect(new Set(probes.map((probe) => probe.id)).size).toBe(7);
	expect(decisionDirectives).toEqual({
		approve: "[SPLATES APPROVE]",
		merge: "[SPLATES MERGE]",
	});
});

it("observes placement, stable numbering, chosen answers and checked state through the production parser", () => {
	const plan = `## Notes
Chose three retries over five.
## Blocked
- [x] 3. (small) Which local retry limit? → b
  - (a) Three (chosen)
  - (b) Five
`;
	expect(decisionState(plan)).toEqual({
		"plan/notes": true,
		"plan/blocked": [
			{ number: "3", done: true, size: "small", reply: "b", chosen: ["a"] },
		],
		"plan/review-requested": false,
		"plan/blocked-kinds": [{ number: "3", size: "small", done: true }],
	});
	const selected = probes.find(
		(probe) => probe.id === "decisions/answer",
	) as Probe;
	const evidence: Evidence = {
		events: [],
		state: decisionState(plan),
		complete: ["state", "events"],
		termination: "stop",
	};
	expect(assess(selected, evidence).status).toBe("uncovered");
	expect(
		[
			plan.replace("[x] 3", "[ ] 3"),
			plan.replace("3.", "2."),
			plan.replace("→ b", "→ a"),
			plan.replace("## Blocked", "## Notes"),
		].map(
			(wrong) =>
				assess(selected, { ...evidence, state: decisionState(wrong) }).status,
		),
	).toEqual(["fail", "fail", "fail", "fail"]);
});

it.each([undefined, 0, 1])(
	"keeps merge attempts with exit %s, actors and incomplete capture distinct",
	// scry-ignore simple-test-setup: each exit-code variant uses this isolated assertion; no setup is shared with state or CLI cases.
	(exitCode) => {
		const selected = probes.find(
			(probe) => probe.id === "decisions/answer",
		) as Probe;
		const assertion = selected.assertions.find(
			(assertion) => assertion.id === "no-canonical-merge",
		);
		const isolated = { ...selected, assertions: assertion ? [assertion] : [] };

		const evidence: Evidence = {
			events: [
				{
					id: "attempt",
					actor: "agent",
					kind: "command",
					name: "splates",
					args: ["merge"],
					exitCode,
				},
			],
			state: {},
			complete: ["events"],
			termination: "stop",
		};
		expect(assess(isolated, evidence).status).toBe("fail");
		expect(assess(isolated, { ...evidence, complete: [] }).status).toBe(
			"uncovered",
		);
		expect(
			assess(isolated, {
				...evidence,
				events: evidence.events.map((event) => ({
					...event,
					actor: "fixture",
				})),
			}).status,
		).toBe("pass");
		expect(
			selected.assertions.some((assertion) => assertion.kind === "uncovered"),
		).toBe(true);
	},
);

// scry-ignore simple-test-setup: review parsing needs a dedicated report and state fixture, unlike the decision and CLI tests.
it("recognizes repeated review structure without mistaking prose, quotes or a claim for state", () => {
	const selected = probes.find(
		(probe) => probe.id === "decisions/review-follow-up",
	) as Probe;
	const reply = `## 🔍 Ready to merge decision onto main

The local fixture records a decision.

Checks: \`fixture-check\`

Reply "merge", or say what to change.`;
	const review = stretches(reply).find((part) => part.type === "review");
	expect(review?.type === "review" && review.review.checks).toEqual([
		"fixture-check",
	]);
	const state = {
		"plan/review-requested": true,
		"task/status": "working",
	};
	const evidence: Evidence = {
		events: [],
		state,
		reply,
		complete: ["events", "state", "reply"],
		termination: "stop",
	};
	expect(assess(selected, evidence).status).toBe("uncovered");
	expect(
		[
			"Ready to merge decision onto main",
			`\`\`\`md\n${reply}\n\`\`\``,
			reply.replace('Reply "merge", or say what to change.', "Thanks!"),
		].map((wrong) => assess(selected, { ...evidence, reply: wrong }).status),
	).toEqual(["fail", "fail", "fail"]);
});

// Synthetic expected evidence tests the assertions only, never model compliance.
it.each(probes.filter((probe) => probe.execution.kind === "agent"))(
	"checks positive, missing and wrong state for $id",
	// scry-ignore simple-test-setup: expected state is derived separately for each probe; it is not shared mutable setup.
	(probe) => {
		const reply = `1. (large) Which recipients?
  - (a) Existing customers (chosen)
  - (b) New customers

## 🔍 Ready to merge decision onto main

The fixture records a local choice.

Reply "merge", or say what to change.`;
		const state = Object.fromEntries(
			probe.assertions.flatMap((assertion) =>
				assertion.kind === "state" ? [[assertion.key, assertion.equals]] : [],
			),
		);
		const evidence: Evidence = {
			events: [],
			state,
			reply,
			complete: ["events", "state", "reply"],
			termination: "stop",
		};
		expect(
			assess(probe, evidence).verdicts.filter(
				(verdict) => verdict.status === "fail",
			),
		).toEqual([]);
		expect(assess(probe, evidence).status).toBe("uncovered");
		const states = probe.assertions.filter(
			(assertion) => assertion.kind === "state",
		);
		expect(
			states.map(
				(assertion) =>
					assess(
						{ ...probe, assertions: [assertion] },
						{ ...evidence, state: {} },
					).status,
			),
		).toEqual(states.map(() => "uncovered"));
		expect(
			states.map(
				(assertion) =>
					assess(
						{ ...probe, assertions: [assertion] },
						{ ...evidence, state: { [assertion.key]: "wrong" } },
					).status,
			),
		).toEqual(states.map(() => "fail"));
	},
);

it("discovers the decision module without a shared registry entry", async () => {
	const discovered = await loadModules([]);
	expect(
		discovered.probes.filter((probe) => probe.aspect === "decisions"),
	).toEqual(probes);
});
