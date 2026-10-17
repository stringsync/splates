import { expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
// biome-ignore lint/style/noRestrictedImports: test the production payload boundary without changing the shared package API.
import * as prompts from "../../packages/arbor/prompts";
import module from "./orchestration.probes";
import {
	assess,
	type Event,
	type Evidence,
	type Match,
	type Probe,
} from "./probe";
import { cliAdapter } from "./probe-adapters";
import { runProbes, validate } from "./runner";

it("validates unique, bounded orchestration cases", () => {
	validate(module.probes);
	expect(new Set(module.probes.map((probe) => probe.id)).size).toBe(
		module.probes.length,
	);
});

// Synthetic witnesses test assertion sensitivity, never actual agent adherence.
function witness(probe: Probe): Evidence {
	const events: Event[] = [];
	const add = (match: Match) =>
		events.push({ args: [], ...match, id: `e${events.length}` });
	const state: Evidence["state"] = {};
	for (const assertion of probe.assertions) {
		if (assertion.kind === "count" && assertion.min > 0) {
			add(assertion.match);
		}
		if (assertion.kind === "before") {
			add(assertion.first);
			add(assertion.second);
		}
		if (assertion.kind === "state") {
			state[assertion.key] = assertion.equals;
		}
	}
	// Duplicate required actions before an ordering pair would obscure the intended witness.
	const ordered = events.filter(
		(event, index) =>
			events.findIndex(
				(other) => JSON.stringify(other.args) === JSON.stringify(event.args),
			) === index,
	);
	for (const assertion of probe.assertions) {
		if (assertion.kind !== "before") {
			continue;
		}
		const first = ordered.findIndex(
			(event) =>
				JSON.stringify(event.args) === JSON.stringify(assertion.first.args),
		);
		const second = ordered.findIndex(
			(event) =>
				JSON.stringify(event.args) === JSON.stringify(assertion.second.args),
		);
		if (first > second) {
			const [event] = ordered.splice(first, 1);
			ordered.splice(second, 0, event as Event);
		}
	}
	return {
		events: ordered,
		state,
		reply:
			"## 🏁 Finished lanes Widgets\n\nThe widget work is done.\n\n1. What should become of work-1?",
		complete: ["events", "state", "reply"],
		termination: "stop",
	};
}

// scry-ignore simple-test-setup: every exported schema case must receive the same adversarial evidence mutations; this is a contract matrix, not scenario setup.
for (const probe of module.probes.filter(
	(probe) => probe.execution.kind === "agent",
)) {
	it(`${probe.id}: positive fixture preserves explicit gaps`, () => {
		const result = assess(probe, witness(probe));
		expect(
			result.verdicts.filter((verdict) => verdict.status === "fail"),
		).toEqual([]);
		expect(result.status).toBe("uncovered");
	});
	it(`${probe.id}: missing or incomplete capture cannot pass`, () => {
		const positive = witness(probe);
		expect(
			assess(probe, {
				...positive,
				events: [],
				state: {},
				reply: "",
			}).verdicts.some((verdict) => verdict.status === "fail"),
		).toBe(true);
		expect(
			assess(probe, { ...positive, complete: [] }).verdicts.every(
				(verdict) => verdict.status === "uncovered",
			),
		).toBe(true);
	});
	it(`${probe.id}: fixture actions and failed attempts cannot satisfy required agent commands`, () => {
		const positive = witness(probe);
		expect(
			assess(probe, {
				...positive,
				events: positive.events.map((event) => ({
					...event,
					actor: "fixture" as const,
				})),
			}).status,
		).toBe("fail");
		expect(
			assess(probe, {
				...positive,
				events: positive.events.map((event) => ({ ...event, exitCode: 1 })),
			}).status,
		).toBe("fail");
	});
	for (const assertion of probe.assertions) {
		if (assertion.kind === "before") {
			it(`${probe.id}: rejects reversed ${assertion.id}`, () => {
				const evidence = witness(probe);
				evidence.events.reverse();
				expect(
					assess(probe, evidence).verdicts.find(
						(verdict) => verdict.id === assertion.id,
					)?.status,
				).toBe("fail");
			});
		}
		if (assertion.kind === "count" && assertion.max === 0) {
			it(`${probe.id}: rejects failed forbidden ${assertion.id}`, () => {
				const evidence = witness(probe);
				evidence.events.push({
					args: [],
					...assertion.match,
					id: "forbidden",
					exitCode: 1,
				});
				expect(
					assess(probe, evidence).verdicts.find(
						(verdict) => verdict.id === assertion.id,
					)?.status,
				).toBe("fail");
			});
		}
	}
}

it("checks production directive payload/format constructors separately from agent responses", () => {
	const emitted = [
		prompts.laneReference(1),
		prompts.laneReference(null),
		prompts.reportReference("work-1"),
		prompts.idleReference("work-1"),
		prompts.stoppedReference("work-1"),
		prompts.todoDoneReference(1),
		prompts.todoOpenReference(1),
		prompts.LANES_DONE,
		prompts.DEFER,
	];
	expect(emitted).toEqual([
		"[ARBOR LANE 1]",
		"[ARBOR LANE untriaged]",
		"[ARBOR REPORT work-1]",
		"[ARBOR IDLE work-1]",
		"[ARBOR STOPPED work-1]",
		"[ARBOR TODO DONE #1]",
		"[ARBOR TODO OPEN #1]",
		"[ARBOR LANES DONE]",
		"[ARBOR DEFER]",
	]);
	expect(
		emitted.map((text) => prompts.leadingDirectives(`${text}\nDetail`)),
	).toEqual(emitted.map((text) => ({ directives: [text], rest: "Detail" })));
});

it("executes a free isolated CLI dependency update and observes persisted state", async () => {
	const directory = await mkdtemp(join(tmpdir(), "orchestration-cli-"));
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
				cliHash: "local-cli",
				reproduction: [],
			},
		);
		expect(
			results.map((result) => ({
				status: result.result.status,
				detail: result.result.detail,
				verdicts: result.result.verdicts,
			})),
		).toEqual([
			{
				status: "pass",
				detail: undefined,
				verdicts: [
					expect.objectContaining({ id: "linked-board", status: "pass" }),
				],
			},
		]);
		expect(results[0]?.run.evidence.complete).not.toContain("events");
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}, 30000);

// This adapter does no agent work. It validates setup and observation only.
it("prepares every real CLI seed without launching workers", async () => {
	const directory = await mkdtemp(join(tmpdir(), "orchestration-seeds-"));
	try {
		const results = await runProbes(
			{
				...module,
				probes: module.probes.filter(
					(probe) => probe.execution.kind === "agent",
				),
			},
			[
				{
					model: null,
					adapter: {
						id: "seed-only",
						version: "1",
						config: {},
						tokenBound: true,
						async run(context) {
							context.reply("Seed observation only.");
						},
					},
				},
			],
			{
				directory,
				parallel: 2,
				reps: 1,
				skillHash: "fixture",
				cliHash: "local",
				reproduction: [],
			},
		);
		expect(
			results
				.filter((result) =>
					["infrastructure-error", "bound"].includes(result.result.status),
				)
				.map((result) => ({
					id: result.probe.id,
					detail: result.result.detail,
				})),
		).toEqual([]);
		expect(
			results.every(
				(result) => !result.run.evidence.complete.includes("events"),
			),
		).toBe(true);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}, 120000);
