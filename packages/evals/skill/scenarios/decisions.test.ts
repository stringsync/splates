import { expect, it } from "bun:test";
import { nextHasContext, reviewRequested } from "./decisions";

it("sees the choice noted under a Next step", () => {
	const bare = "## Next\n\n- [ ] Pick a limit\n\n## Blocked\n";
	const noted =
		"## Next\n\n- [ ] Pick a limit\n  Chose three over five.\n\n## Blocked\n";
	expect([bare, noted].map(nextHasContext)).toEqual([false, true]);
});

it("sees a requested review step", () => {
	expect(reviewRequested("- [ ] Show the user before merging")).toBe(true);
	expect(reviewRequested("- [x] Prepare")).toBe(false);
});
