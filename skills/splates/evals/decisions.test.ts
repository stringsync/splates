import { expect, it } from "bun:test";
import { hasBlocked, nextHasContext, reviewRequested } from "./decisions";

it("sees the choice noted under a Next step", () => {
	const bare = "## Next\n\n- [ ] Pick a limit\n";
	const noted = "## Next\n\n- [ ] Pick a limit\n  Chose three over five.\n";
	expect([bare, noted].map(nextHasContext)).toEqual([false, true]);
});

it("sees a requested review step", () => {
	expect(reviewRequested("- [ ] Show the user before merging")).toBe(true);
	expect(reviewRequested("- [x] Prepare")).toBe(false);
});

it("sees a Blocked section", () => {
	expect(
		hasBlocked("## Next\n\n- [ ] Step\n\n## Blocked\n- [ ] 1. Ask\n"),
	).toBe(true);
	expect(hasBlocked("## Before\n\n## After\n\n## Next\n")).toBe(false);
});
