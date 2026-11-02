import { expect, it } from "bun:test";
import { Testing } from "../testing";
import { EvalLoopStore, type LoopChange } from "./loops";
import { LoopRecovery } from "./recovery";

const contract = {
	scenario: "case",
	suiteRevision: "suite",
	target: { model: "test", agent: "codex" },
	repetitions: 1,
};
const batch = { id: "baseline", contract, revision: "base" };
const comparison = {
	id: "comparison",
	contract,
	revision: "candidate",
	baselineBatchId: "baseline",
};

it("recovers every persisted lifecycle state without advancing, including full history", async () => {
	await using env = await Testing.open();
	const store = new EvalLoopStore(env.storage);
	await store.start("loop", {
		contract,
		revision: "base",
		conversation: "c",
		task: "code",
	});
	const snapshot = async () => {
		const saved = await store.show("loop");
		const recovery = new LoopRecovery(env.storage, env.machine, env.root);
		const result = await recovery.show("loop");
		return {
			state: result.loop.stage.kind,
			history: result.history,
			savedHistory: saved.history,
			unchanged: await store.show("loop"),
			saved,
			directive: result.directive,
			conversation: await recovery.conversation("c"),
			unrelated: await recovery.conversation("unrelated"),
		};
	};
	const advance = async (event: LoopChange["event"]) => {
		const saved = await store.show("loop");
		await store.change("loop", {
			id: `event-${saved.version}`,
			expectedVersion: saved.version,
			event,
		});
		return snapshot();
	};
	const results = [
		await snapshot(),
		await advance({ type: "start-batch", batch }),
		await advance({
			type: "finish-batch",
			completion: { batch, results: ["fail"] },
		}),
		await advance({
			type: "diagnose",
			diagnosis: "skill",
			hypothesis: "clarify",
		}),
		await advance({ type: "candidate-ready", contract, revision: "candidate" }),
		await advance({ type: "start-batch", batch: comparison }),
		await advance({
			type: "finish-batch",
			completion: {
				batch: comparison,
				results: ["pass"],
				baselineResults: ["fail"],
			},
		}),
		await advance({ type: "decide", action: "keep", reason: "gain" }),
	];
	expect(results.map((result) => result.state)).toEqual([
		"baseline-awaiting-run",
		"baseline-running",
		"baseline-diagnosing",
		"editing",
		"awaiting-comparison",
		"comparing",
		"deciding",
		"complete",
	]);
	expect(results.map((result) => result.history)).toEqual(
		results.map((result) => result.savedHistory),
	);
	expect(results.map((result) => result.unchanged)).toEqual(
		results.map((result) => result.saved),
	);
	expect(results.map((result) => result.conversation)).toEqual(
		results.map((result) => result.directive),
	);
	expect(results.map((result) => result.unrelated)).toEqual(Array(8).fill(""));

	await store.start("stopped", {
		contract,
		revision: "base",
		conversation: "c",
	});
	await store.change("stopped", {
		id: "stop",
		expectedVersion: 0,
		event: { type: "stop", reason: "person stopped" },
	});
	expect(
		(await new LoopRecovery(env.storage, env.machine, env.root).show("stopped"))
			.next,
	).toContain("stopped");
});

it.each([
	["running", null, "Reattach"],
	["refused", "baseline", "refused"],
	["done", "baseline", "Inspect existing batch"],
	["stopped", "baseline", "Inspect existing batch"],
])("recovers a %s request without spending", async (status, batchId, next) => {
	await using env = await Testing.open();
	const store = new EvalLoopStore(env.storage);
	const saved = await store.start("loop", {
		contract,
		revision: "base",
		conversation: "c",
	});

	await env.machine.document("eval-launches.json").write({
		request: {
			launch: {
				id: "request",
				key: "card",
				status,
				batch: batchId,
				output: "",
			},
			commands: { root: env.root, results: "results" },
			spec: { loop: { id: "loop", version: 0 } },
		},
	});
	const result = await new LoopRecovery(
		env.storage,
		env.machine,
		env.root,
	).show("loop");
	expect(result.directive).toContain("Run request: request");
	expect(result.next).toContain(next as string);
	expect(await store.show("loop")).toEqual(saved);
});

it("reconciles a lost completion once and leaves failed evidence awaiting diagnosis", async () => {
	await using env = await Testing.open();
	const store = new EvalLoopStore(env.storage);
	await store.start("loop", { contract, revision: "base", conversation: "c" });
	const results = `${env.root}/results`;
	await env.fs.mkdir(`${results}/baseline`);
	await env.fs.write(
		`${results}/baseline/batch.json`,
		JSON.stringify({
			format: "splates-evals/1",
			startedAt: "2026-11-02T00:00:00Z",
			cells: [
				{ id: "cell", case: "case", target: { model: "test", agent: "codex" } },
			],
		}),
	);
	await env.machine.document("eval-launches.json").write({
		request: {
			launch: {
				id: "request",
				key: "card",
				status: "done",
				batch: "baseline",
				output: "",
			},
			commands: { root: env.root, results },
			spec: { loop: { id: "loop", version: 0 } },
		},
	});
	const recovery = new LoopRecovery(env.storage, env.machine, env.root);
	expect(recovery.reconcile("loop")).rejects.toThrow("missing unique");
	expect((await store.show("loop")).version).toBe(0);
	await env.fs.write(
		`${results}/baseline/results.jsonl`,
		`${JSON.stringify({ cell: "cell", status: "fail" })}\n`,
	);
	await recovery.reconcile("loop");
	await recovery.reconcile("loop");
	expect((await recovery.show("loop")).loop.stage.kind).toBe(
		"baseline-diagnosing",
	);
	expect((await store.show("loop")).version).toBe(2);
	await store.change("loop", {
		id: "diagnosis",
		expectedVersion: 2,
		event: { type: "diagnose", diagnosis: "skill", hypothesis: "clarify" },
	});
	await recovery.reconcile("loop");
	expect((await store.show("loop")).version).toBe(3);
});
