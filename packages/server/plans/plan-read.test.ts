import { describe, expect, it } from "bun:test";
import { FakeFs } from "webappwiz/system/testing";
import { Plans } from "./plan";

describe("Plans.read", () => {
	it("reads a worktree's ARBOR.md when it has no SPLATES.md", async () => {
		const fs = new FakeFs();
		await fs.write("/tree/ARBOR.md", "# old");

		expect(await new Plans(fs).read("/tree")).toBe("# old");
	});

	it("reads SPLATES.md over ARBOR.md", async () => {
		const fs = new FakeFs();
		await fs.write("/tree/ARBOR.md", "# old");
		await fs.write("/tree/SPLATES.md", "# new");

		expect(await new Plans(fs).read("/tree")).toBe("# new");
	});
});
