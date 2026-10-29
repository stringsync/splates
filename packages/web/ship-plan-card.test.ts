import { describe, expect, it } from "bun:test";
import type { ShownRun } from "@stringsync/splates-server/ship";
import { standingOf } from "./ship-plan-card";

function shown(state: string, id: string | undefined): ShownRun {
	return {
		run: { state, ...(id === undefined ? {} : { frozen: { id } }) },
		plan: null,
	} as unknown as ShownRun;
}

describe("standingOf", () => {
	it("waits for approval while its plan is the frozen proposal", () => {
		expect(standingOf(shown("proposed", "a"), "a")).toBe("proposed");
	});

	it("is the live run once its plan was approved", () => {
		expect(standingOf(shown("running", "a"), "a")).toBe("started");
	});

	it("is superseded once another plan or no run holds", () => {
		expect(standingOf(shown("proposed", "b"), "a")).toBe("superseded");
		expect(standingOf(shown("planning", undefined), "a")).toBe("superseded");
		expect(standingOf(null, "a")).toBe("superseded");
	});
});
