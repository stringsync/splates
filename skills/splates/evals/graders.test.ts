import { expect, it } from "bun:test";
import { citesRun, showsRegrade } from "./graders";

it("sees a cited batch and run", () => {
	expect(citesRun("Misjudged batch-Ab12Cd run-004")).toBe(true);
	expect(citesRun("a run misjudged it")).toBe(false);
});

it("sees the regrade list", () => {
	expect(showsRegrade("bin/evals regrade lists one flip")).toBe(true);
	expect(showsRegrade("tests pass")).toBe(false);
});
