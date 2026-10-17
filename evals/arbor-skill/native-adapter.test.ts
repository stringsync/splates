import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type NativeDriver,
	type NativeUpdate,
	nativeAdapter,
} from "./native-adapter";
import type { Probe } from "./probe";
import { declared } from "./probe-budget-policy";
import { EvalBudgets } from "./probe-budget-store";
import { runProbes } from "./runner";

let directory: string;
beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), "native-foundation-"));
});
afterEach(async () => {
	await rm(directory, { recursive: true, force: true });
});

it("cancels on monitored crossing, disposes, retains overshoot and prevents queued starts", async () => {
	const fixture = new NativeFixture();
	fixture.updates = [{ kind: "usage", tokens: 150, costUsd: 0.002 }];
	const results = await fixture.run(directory, 2);
	expect(fixture.started).toBe(1);
	expect(fixture.cancelled).toBe(1);
	expect(fixture.disposed).toBe(1);
	expect(results[0]?.result.status).toBe("bound");
	expect(results[0]?.adapter.runtime.overshoot).toEqual({
		tokens: 50,
		microUsd: 1000,
	});
	expect(results[1]?.run.evidence.detail).toBe("cancelled before start");
	expect((await fixture.ledger?.report())?.windows[0]?.remaining).toBe(0);
});

it("grades reply/state independently while missing events remain uncovered and unknown usage stays reserved", async () => {
	const fixture = new NativeFixture();
	fixture.updates = [{ kind: "reply", text: "done" }];
	const [result] = await fixture.run(directory);
	expect(result?.run.usage.tokens).toBeNull();
	expect(result?.result.verdicts).toContainEqual(
		expect.objectContaining({ id: "state", status: "pass" }),
	);
	expect(result?.result.verdicts).toContainEqual(
		expect.objectContaining({
			id: "$runner/complete/events",
			status: "uncovered",
		}),
	);
	expect(
		(await fixture.ledger?.report())?.reservations[0]?.finished,
	).toBeNull();
	expect(fixture.disposed).toBe(1);
});

it("keeps hard-limit violation distinct from monitored overshoot", async () => {
	const fixture = new NativeFixture();
	fixture.limits = { tokens: "hard", costUsd: "hard" };
	fixture.updates = [{ kind: "usage", tokens: 101, costUsd: 0.001 }];
	const [result] = await fixture.run(directory);
	expect(result?.result.status).toBe("infrastructure-error");
});

it("charges observed overshoot beyond reservations against future admission", async () => {
	const ledger = new EvalBudgets(
		join(directory, "ledger"),
		declared({ tokens: 250, per: "day" }, "test"),
	);
	const id = await ledger.reserve([{ tokens: 100, microUsd: 1000 }]);
	await ledger.finish(id, [{ tokens: 240, costUsd: 0.001 }], true);
	expect((await ledger.report()).windows[0]?.remaining).toBe(10);
	await expect(
		ledger.reserve([{ tokens: 11, microUsd: 1000 }]),
	).rejects.toThrow("exhausted");
});

class NativeFixture implements NativeDriver {
	id = "free-native";
	version = "1";
	config = {};
	limits: NativeDriver["limits"] = {
		tokens: "monitored",
		costUsd: "unavailable",
	};
	updates: NativeUpdate[] = [];
	started = 0;
	cancelled = 0;
	disposed = 0;
	ledger?: EvalBudgets;
	quote() {
		return { tokens: 100, microUsd: 1000 };
	}
	create() {
		return {
			run: async (emit: (update: NativeUpdate) => void) => {
				this.started++;
				for (const update of this.updates) {
					emit(update);
				}
			},
			cancel: () => {
				this.cancelled++;
			},
			dispose: () => {
				this.disposed++;
			},
		};
	}
	async run(path: string, reps = 1) {
		this.ledger = new EvalBudgets(
			join(path, "ledger"),
			declared({ tokens: 200, per: "day" }, "test"),
		);
		return runProbes(
			{
				probes: [probe],
				seeds: [
					{
						id: "empty",
						version: "1",
						fingerprint: "1",
						async prepare() {},
						async observe() {
							return { ok: true };
						},
					},
				],
			},
			[
				{
					adapter: nativeAdapter(this, {
						source: "fixture-skill",
						mode: "discovery",
					}),
					model: "fixture",
				},
			],
			{
				directory: path,
				parallel: 1,
				reps,
				skillHash: "test",
				cliHash: "test",
				reproduction: [],
				budget: { tokens: 200, microUsd: 2000 },
				sharedBudget: this.ledger,
			},
		);
	}
}
const probe: Probe = {
	schema: 1,
	id: "native",
	version: "1",
	requirement: { id: "test", text: "test", source: "test" },
	aspect: "test",
	seed: { id: "empty", version: "1", data: null },
	input: { kind: "message", text: "answer", origin: "user" },
	tools: [],
	evidence: ["reply", "state", "events"],
	assertions: [{ id: "state", kind: "state", key: "ok", equals: true }],
	stop: { kind: "reply" },
	bounds: { milliseconds: 1000, turns: 1, tokens: 100 },
	execution: { kind: "agent", skill: "arbor" },
};
