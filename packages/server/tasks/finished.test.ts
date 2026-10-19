import { describe, expect, it } from "bun:test";
import { FakeFs } from "webappwiz/system/testing";
import { Finished, type FinishedPlan } from "./finished";

describe("Finished", () => {
	it("lists the latest to finish first, without plans", async () => {
		const finished = new Finished("/finished", new FakeFs());
		await finished.record(ended(1, "2026-10-01T01:00:00.000Z"));
		await finished.record(
			ended(2, "2026-10-01T02:00:00.000Z", {
				ended: "removed",
				reason: "moot",
				commit: null,
			}),
		);

		const listed = await finished.list();

		expect(listed.map((each) => each.task)).toEqual(["task-2", "task-1"]);
		expect(listed[0]).toMatchObject({ ended: "removed", reason: "moot" });
		expect("plan" in (listed[0] ?? {})).toBe(false);
	});

	it("reads one back with the plan it ended on", async () => {
		const finished = new Finished("/finished", new FakeFs());
		await finished.record(
			ended(3, "2026-10-01T03:00:00.000Z", {
				took: [{ id: 3, subject: "do 3" }],
			}),
		);
		const [listed] = await finished.list();

		const read = await finished.read(listed?.key ?? "");

		expect(read?.plan).toBe("# task-3\n\n## Goal\n\ndo 3");
		expect(read?.took).toEqual([{ id: 3, subject: "do 3" }]);
	});

	it("keeps a number's every finish apart", async () => {
		const finished = new Finished("/finished", new FakeFs());
		await finished.record(ended(4, "2026-10-01T04:00:00.000Z"));
		await finished.record(ended(4, "2026-10-02T04:00:00.000Z"));

		expect(await finished.list()).toHaveLength(2);
	});

	it("keeps only the newest it has room for", async () => {
		const finished = new Finished("/finished", new FakeFs(), 2);
		await finished.record(ended(1, "2026-10-01T01:00:00.000Z"));
		await finished.record(ended(2, "2026-10-01T02:00:00.000Z"));
		await finished.record(ended(3, "2026-10-01T03:00:00.000Z"));

		expect((await finished.list()).map((each) => each.id)).toEqual([3, 2]);
	});

	it("reads nothing outside its folder", async () => {
		const finished = new Finished("/finished", new FakeFs());

		expect(await finished.read("../tasks/1")).toBeNull();
	});
});

function ended(
	id: number,
	endedAt: string,
	more: Partial<FinishedPlan> = {},
): Omit<FinishedPlan, "key"> {
	return {
		id,
		task: `task-${id}`,
		subject: `do ${id}`,
		ended: "merged",
		reason: null,
		base: "main",
		commit: "abc1234",
		startedAt: "2026-10-01T00:00:00.000Z",
		endedAt,
		conversation: null,
		took: [],
		plan: `# task-${id}\n\n## Goal\n\ndo ${id}\n`,
		...more,
	};
}
