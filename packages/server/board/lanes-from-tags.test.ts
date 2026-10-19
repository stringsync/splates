import { beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { FakeFs, FakePs } from "webappwiz/system/testing";
import { lanesFromTags } from "./lanes-from-tags";
import { decodeTask, encodeTask } from "./task-file";

describe("lanesFromTags", () => {
	let fs: FakeFs;
	let log: MemoryLogger;

	const tagged = (id: number, tags: string[]) =>
		encodeTask({
			id,
			subject: `task ${id}`,
			text: "",
			position: id,
			from: null,
			createdAt: "2026-01-01T00:00:00.000Z",
			takenBy: null,
			files: [],
			tags,
		});
	const said = () => log.entries.map((entry) => String(entry.message));

	beforeEach(async () => {
		fs = new FakeFs();
		log = new MemoryLogger();
		await fs.mkdir("/repo/.git/splates/tasks");
		await fs.write("/repo/.git/splates/tasks/1.md", tagged(1, ["uploads"]));
		await fs.write("/repo/.git/splates/tasks/2.md", tagged(2, []));
	});

	it("finds the tasks from a worktree, through its .git file", async () => {
		await fs.mkdir("/repo/.git/worktrees/fix");
		await fs.write("/repo/.git/worktrees/fix/commondir", "../..\n");
		await fs.mkdir("/trees/fix");
		await fs.write("/trees/fix/.git", "gitdir: /repo/.git/worktrees/fix\n");

		await lanesFromTags({ dir: "/trees/fix", fs, log, ps: new FakePs() });

		expect(said()).toEqual(["moved #1 into lane 1 Uploads, from their tag"]);
		expect(
			decodeTask(await fs.read("/repo/.git/splates/tasks/2.md"))?.lane,
		).toBeUndefined();
	});

	it("says nothing outside a repository, or once no task has tags", async () => {
		await fs.mkdir("/elsewhere");
		await lanesFromTags({ dir: "/elsewhere", fs, log, ps: new FakePs() });
		await lanesFromTags({ dir: "/repo", fs, log, ps: new FakePs() });
		log.clear();

		await lanesFromTags({ dir: "/repo", fs, log, ps: new FakePs() });

		expect(said()).toEqual([]);
	});
});
