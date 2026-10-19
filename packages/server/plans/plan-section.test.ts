import { describe, expect, it } from "bun:test";
import { sectionApart } from "./plan";

const PLAN = "# alpha\n\n## Goal\nship it\n\n## Notes\n- lives in plan.ts\n";

describe("sectionApart", () => {
	it("takes a section out, heading and all, up to the next of its level", () => {
		const plan =
			"# alpha\n\n## Goal\nship it\n\n## Verification\nran the tests\n\n### screens\n![a](/a.png)\n\n## Blocked\n- [ ] 1. ok?\n";

		const apart = sectionApart(plan, "verification");

		expect(apart.section).toBe(
			"## Verification\nran the tests\n\n### screens\n![a](/a.png)",
		);
		expect(apart.rest).toBe(
			"# alpha\n\n## Goal\nship it\n\n## Blocked\n- [ ] 1. ok?\n",
		);
	});

	it("leaves a plan without it whole", () => {
		expect(sectionApart(PLAN, "Verification")).toEqual({
			section: null,
			rest: PLAN,
		});
	});
});
