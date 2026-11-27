import { describe, expect, it } from "bun:test";
import {
	allows,
	DECISION_WEIGHTS,
	floorOf,
	TRUST_ACTIONS,
	TRUST_BANDS,
	trustAction,
} from "./actions";
import { ASSUME_AT, WAIT_BELOW } from "./band";
import { outcomeWeights } from "./score";

describe("trust actions", () => {
	it("allows an action from its band up, and limits below it", () => {
		expect(allows("ask-and-wait", "merge-without-approval")).toBe(false);
		expect(allows("ask-and-go", "merge-without-approval")).toBe(true);
		expect(allows("assume", "merge-without-approval")).toBe(true);
		expect(allows("ask-and-go", "assume-reversible")).toBe(false);
		expect(allows("assume", "assume-reversible")).toBe(true);
	});

	it("holds an any-trust rule in every band", () => {
		expect(TRUST_BANDS.map((band) => allows(band, "only-user-ships"))).toEqual([
			true,
			true,
			true,
		]);
		expect(floorOf("only-user-ships")).toBe(0);
	});

	it("takes its thresholds from the bands", () => {
		expect(floorOf("merge-without-approval")).toBe(WAIT_BELOW);
		expect(floorOf("assume-reversible")).toBe(ASSUME_AT);
	});

	it("enforces exactly merge and ship on the server", () => {
		expect(
			TRUST_ACTIONS.filter(
				(each) => each.enforced && each.id !== "everything-ask-and-go-allows",
			).map((each) => each.id),
		).toEqual([
			"merge-after-approval",
			"merge-without-approval",
			"only-user-ships",
		]);
		expect(trustAction("assume-reversible").enforced).toBe(false);
	});

	it("scores decisions with the table's weights", () => {
		expect(outcomeWeights({ source: "plan", outcome: "overturned" })).toBe(
			DECISION_WEIGHTS.plan.overturned,
		);
		expect(DECISION_WEIGHTS.revert.overturned).toEqual({ alpha: 0, beta: 3 });
	});
});
