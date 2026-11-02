import { expect, it } from "bun:test";
import { Testing } from "../testing";
import { LoopRuns } from "./loop-run";
import { EvalLoopStore } from "./loops";
import type { EvalGrid } from "./types";

it("refuses contract drift and stale run cards before spending; rejection leaves the loop awaiting", async () => {
	await using env = await Testing.open();
	const store = new EvalLoopStore(env.storage);
	await store.start("loop", { contract, revision: "base", conversation: "c1" });
	await new LoopRuns(store).check(spec);
	expect(new LoopRuns(store).check({ ...spec, reps: 3 })).rejects.toThrow(
		"frozen",
	);
	expect(
		new LoopRuns(store).check({ ...spec, conversation: "other" }),
	).rejects.toThrow("frozen");
	expect(
		new LoopRuns(store).check({ ...spec, scenarios: ["other"] }),
	).rejects.toThrow("frozen");
	expect(
		new LoopRuns(store).check({
			...spec,
			agents: [{ agent: "codex", model: "other" }],
		}),
	).rejects.toThrow("frozen");
	expect(
		new LoopRuns(store).check({ ...spec, loop: { id: "loop", version: 1 } }),
	).rejects.toThrow("changed");
	expect((await store.show("loop")).loop.stage.kind).toBe(
		"baseline-awaiting-run",
	);
	expect((await store.show("loop")).version).toBe(0);
});
it("records completed batches once and preserves reverted experiments and historical cards", async () => {
	await using env = await Testing.open();
	const store = new EvalLoopStore(env.storage);
	await store.start("loop", { contract, revision: "base", conversation: "c1" });
	await new LoopRuns(store).record(spec.loop, grid("first"));
	await new LoopRuns(store).record(spec.loop, grid("first"));
	expect((await store.show("loop")).version).toBe(2);
	expect((await store.at("loop", 0)).loop.stage.kind).toBe(
		"baseline-awaiting-run",
	);
	await store.change("loop", {
		id: "diagnose",
		expectedVersion: 2,
		event: {
			type: "diagnose",
			diagnosis: "Skill layer",
			hypothesis: "Clarify the instruction",
		},
	});
	await store.change("loop", {
		id: "candidate",
		expectedVersion: 3,
		event: { type: "candidate-ready", revision: "candidate", contract },
	});
	await new LoopRuns(store).check({
		...spec,
		baseline: "base",
		loop: { id: "loop", version: 4 },
	});
	await new LoopRuns(store).record(
		{ id: "loop", version: 4 },
		grid("second", true),
	);
	await store.change("loop", {
		id: "revert",
		expectedVersion: 6,
		event: { type: "decide", action: "revert", reason: "No improvement" },
	});
	await new LoopRuns(store).record(
		{ id: "loop", version: 4 },
		grid("second", true),
	);
	const saved = await store.show("loop");
	expect(saved.version).toBe(7);
	expect(saved.loop.rounds[0]?.decision).toEqual({
		action: "revert",
		reason: "No improvement",
	});
	expect((await store.at("loop", 6)).loop.stage.kind).toBe("deciding");
	expect(store.at("loop", 8)).rejects.toThrow("version");
});
it("does not record partial or ambiguous repetitions", async () => {
	await using env = await Testing.open();
	const store = new EvalLoopStore(env.storage);
	await store.start("loop", { contract, revision: "base", conversation: "c1" });
	const incomplete = grid("bad");
	incomplete.grid.pop();
	expect(new LoopRuns(store).record(spec.loop, incomplete)).rejects.toThrow(
		"repetition",
	);
	expect((await store.show("loop")).version).toBe(0);
});

const contract = {
	scenario: "case",
	suiteRevision: "suite",
	target: { agent: "codex", model: "test" },
	repetitions: 2,
};
const spec = {
	key: "card",
	skill: "splates",
	scenarios: ["case"],
	agents: [{ agent: "codex", model: "test" }],
	baseline: null,
	reps: 2,
	conversation: "c1",
	loop: { id: "loop", version: 0 },
};
function grid(id: string, comparison = false): EvalGrid {
	const targets = [
		{
			key: "candidate",
			agent: "codex",
			model: "test",
			effort: null,
			skill: null,
		},
		...(comparison
			? [
					{
						key: "baseline",
						agent: "codex",
						model: "test",
						effort: null,
						skill: "base",
					},
				]
			: []),
	];
	return {
		id,
		skill: "splates",
		producer: "splates",
		startedAt: "",
		targets,
		cells: targets.length * 2,
		tally: {},
		tokens: null,
		costUsd: null,
		grid: targets.flatMap((target) =>
			[0, 1].map((repetition) => ({
				scenario: "case",
				aspect: "",
				requirement: "",
				target: target.key,
				repetition,
				run: {
					id: `${id}#${target.key}${repetition}`,
					status: "fail" as const,
					tokens: null,
					costUsd: null,
					milliseconds: 0,
				},
			})),
		),
	};
}
