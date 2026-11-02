import { expect, it } from "bun:test";
import { SqliteStorage } from "../storage";
import { Testing } from "../testing";
import { EvalLoopStore, type LoopChange, loopNext } from "./loops";

const contract = {
	scenario: "resources/focused",
	suiteRevision: "suite-1",
	target: { model: "test" },
	repetitions: 2,
};
const start = { contract, revision: "base", conversation: "conversation-1" };
const batch = { id: "baseline", contract, revision: "base" };
it("reopens durable state and history and rejects conflicting creation", async () => {
	await using env = await Testing.open();
	const store = new EvalLoopStore(env.storage);
	await store.start("loop", start);
	await store.change("loop", {
		id: "request-1",
		expectedVersion: 0,
		event: { type: "start-batch", batch },
	});

	const storage = SqliteStorage.open(`${env.dir}/state.db`, {
		fs: env.fs,
		ps: env.ps,
	});
	try {
		// Read through a separately opened database, as a restarted CLI does.
		const reopened = new EvalLoopStore(storage);
		expect(await reopened.show("loop")).toEqual(await store.show("loop"));
		expect((await reopened.start("loop", start)).version).toBe(1);
		expect(
			reopened.start("loop", { ...start, revision: "other" }),
		).rejects.toThrow("already used");
	} finally {
		storage.dispose();
	}
});

it("serializes competing writers, rejects stale writes and deduplicates retries", async () => {
	await using env = await Testing.open();
	const store = new EvalLoopStore(env.storage);
	await store.start("loop", start);
	const request: LoopChange = {
		id: "request",
		expectedVersion: 0,
		event: { type: "start-batch", batch },
	};
	const attempts = await Promise.allSettled([
		store.change("loop", request),
		store.change("loop", {
			id: "stop",
			expectedVersion: 0,
			event: { type: "stop", reason: "done" },
		}),
	]);
	expect(
		attempts.filter((result) => result.status === "fulfilled"),
	).toHaveLength(1);
	expect((await store.show("loop")).history).toHaveLength(1);
	const winner = (await store.show("loop")).history[0] as LoopChange;
	expect(winner).toBeDefined();
	expect((await store.change("loop", winner)).version).toBe(1);
	expect(
		store.change("loop", { ...winner, task: "different" }),
	).rejects.toThrow("different input");
});

it("retains evidence, task links and decisions across rounds without double completion", async () => {
	await using env = await Testing.open();
	const store = new EvalLoopStore(env.storage);
	await store.start("loop", start);
	await store.change("loop", {
		id: "request",
		expectedVersion: 0,
		event: { type: "start-batch", batch },
	});
	const completion: LoopChange = {
		id: "finish",
		expectedVersion: 1,
		event: {
			type: "finish-batch",
			completion: { batch, results: ["fail", "pass"] },
		},
	};
	await store.change("loop", completion);
	await store.change("loop", {
		id: "diagnosis",
		expectedVersion: 2,
		task: "edit-task",
		event: {
			type: "diagnose",
			diagnosis: "missed rule",
			hypothesis: "clarify it",
		},
	});
	expect(
		(await store.change("loop", { ...completion, id: "redelivery" })).version,
	).toBe(3);
	await store.change("loop", {
		id: "candidate",
		expectedVersion: 3,
		event: { type: "candidate-ready", revision: "candidate", contract },
	});
	const comparison = {
		id: "comparison",
		contract,
		revision: "candidate",
		baselineBatchId: batch.id,
	};
	await store.change("loop", {
		id: "compare",
		expectedVersion: 4,
		event: { type: "start-batch", batch: comparison },
	});
	await store.change("loop", {
		id: "compared",
		expectedVersion: 5,
		event: {
			type: "finish-batch",
			completion: {
				batch: comparison,
				results: ["pass", "pass"],
				baselineResults: ["fail", "pass"],
			},
		},
	});
	const done = await store.change("loop", {
		id: "keep",
		expectedVersion: 6,
		event: { type: "decide", action: "keep", reason: "fixed" },
	});
	expect(done.loop.stage.kind).toBe("complete");
	expect(done.task).toBe("edit-task");
	expect(done.loop.rounds).toHaveLength(1);
	expect(done.loop.batches).toHaveLength(2);
	expect(loopNext(done)).toContain("complete");
	expect((await store.change("loop", completion)).version).toBe(7);
	expect(
		store.change("loop", {
			id: "bad",
			expectedVersion: 7,
			event: {
				type: "finish-batch",
				completion: { batch, results: ["pass", "pass"] },
			},
		}),
	).rejects.toThrow("different evidence");
	expect((await store.show("loop")).version).toBe(7);
});

it("rejects unsafe IDs and malformed events without changing state", async () => {
	await using env = await Testing.open();
	const store = new EvalLoopStore(env.storage);
	expect(store.start("../escape", start)).rejects.toThrow();
	await store.start("loop", start);
	expect(
		store.change("loop", {
			id: "bad",
			expectedVersion: 0,
			event: { type: "diagnose", diagnosis: "why", hypothesis: "fix" },
		}),
	).rejects.toThrow("Baseline evidence");
	expect((await store.show("loop")).version).toBe(0);
});

it("lists saved loops without changing their versions", async () => {
	await using env = await Testing.open();
	const store = new EvalLoopStore(env.storage);
	expect(await store.list()).toEqual([]);
	const saved = await store.start("catalog", start);
	expect(await store.list()).toEqual([saved]);
	expect((await store.show("catalog")).version).toBe(0);
});
