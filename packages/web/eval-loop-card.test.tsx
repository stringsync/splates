import { afterEach, expect, it } from "bun:test";

import type { StoredEvalLoop } from "@splates/server/evals/browser";

import { EvalLoopView, loopStep } from "./eval-loop-card";
import { cleanup, render } from "./testing";

afterEach(cleanup);
it("shows the frozen contract and five journey steps without starting a run", () => {
	const view = render(<EvalLoopView saved={saved()} />);
	expect(view.getByText("suite-frozen")).toBeTruthy();
	expect(view.getByText("2/2 pass or 3 no-gain rounds")).toBeTruthy();
	expect(
		view.getByRole("list", { name: "Eval journey" }).textContent,
	).toContain("BaselineDiagnoseExperimentCompareDecision");
	expect(view.queryByRole("button", { name: "Run" })).toBeNull();
});
it("offers keep and revert only after comparison evidence", () => {
	const record = saved();
	record.loop = {
		...record.loop,
		stage: {
			kind: "deciding",
			round: {
				number: 1,
				contract,
				baseline: {
					batchId: "baseline",
					revision: "base",
					results: ["fail", "pass"],
				},
				diagnosis: "Skill",
				hypothesis: "Clarify instruction",
				candidateRevision: "candidate",
				comparison: {
					batch: {
						id: "compare",
						contract,
						revision: "candidate",
						baselineBatchId: "baseline",
					},
					results: ["pass", "pass"],
					baselineResults: ["fail", "pass"],
				},
			},
		},
	};
	expect(loopStep(record)).toBe("Decision");
	const view = render(<EvalLoopView saved={record} />);
	expect(view.getByRole("button", { name: "Keep" })).toBeTruthy();
	expect(view.getByRole("button", { name: "Revert" })).toBeTruthy();
});

const contract = {
	scenario: "landing/merge-message",
	suiteRevision: "suite-frozen",
	target: { model: "test" },
	repetitions: 2,
};
const start = { contract, revision: "base", conversation: "c1" };
function saved(): StoredEvalLoop {
	return {
		format: 1,
		id: "loop",
		version: 0,
		conversation: "c1",
		start,
		loop: {
			contract,
			revision: "base",
			stage: { kind: "baseline-awaiting-run" },
			rounds: [],
			batches: [],
			noGainCount: 0,
		},
		history: [],
	};
}
