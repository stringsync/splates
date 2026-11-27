import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Testing } from "../testing";
import { add } from "./add";

describe("a merged task's outcome", () => {
	let deps: Testing;

	beforeEach(async () => {
		deps = await Testing.open();
	});

	afterEach(() => deps.disposeAsync());

	it("names the archived copy of each inline local image", async () => {
		await add(deps, "alpha");
		const worktree = await deps.service.find("alpha");
		const shot = `${worktree.path}/after.png`;
		await deps.fs.writeBytes(
			shot,
			new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]),
		);
		await deps.fs.write(
			`${worktree.path}/SPLATES.md`,
			`# alpha\n\n## Before\n\nOld.\n\n## After\n\nNew.\n\n![after](${shot})\n`,
		);

		const discarded = await worktree.discard("merged", { commit: "abc1234" });

		expect(discarded.code).toBe(0);
		const outcome = (await deps.outcomes.list()).find(
			(each) => each.task === "alpha",
		)?.outcome;
		expect(outcome).toContain("![after](");
		expect(outcome).toContain("finished/");
		expect(outcome).not.toContain(worktree.path);
	});
});
