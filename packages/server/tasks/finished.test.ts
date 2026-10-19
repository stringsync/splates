import { beforeEach, describe, expect, it } from "bun:test";
import { FakeFs } from "webappwiz/system/testing";
import { Finished, type FinishedPlan } from "./finished";

describe("Finished", () => {
	let fs: FakeFs;
	let finished: Finished;

	beforeEach(async () => {
		fs = new FakeFs();
		await fs.writeBytes("/held/a.png", new Uint8Array([1]));
		await fs.writeBytes("/held/two/a.png", new Uint8Array([2]));
		await fs.writeBytes("/elsewhere/b.png", new Uint8Array([3]));
		finished = new Finished("/finished", fs, 500);
	});

	it("lists the latest to finish first, without plans", async () => {
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
		await finished.record(ended(4, "2026-10-01T04:00:00.000Z"));
		await finished.record(ended(4, "2026-10-02T04:00:00.000Z"));

		expect(await finished.list()).toHaveLength(2);
	});

	it("keeps only the newest it has room for", async () => {
		finished = new Finished("/finished", fs, 2);
		await finished.record(ended(1, "2026-10-01T01:00:00.000Z"));
		await finished.record(ended(2, "2026-10-01T02:00:00.000Z"));
		await finished.record(ended(3, "2026-10-01T03:00:00.000Z"));

		expect((await finished.list()).map((each) => each.id)).toEqual([3, 2]);
	});

	it("keeps a copy of each attached file its plan shows, and names that", async () => {
		await finished.record(
			ended(5, "2026-10-01T05:00:00.000Z", {
				plan: "![a](/held/a.png) and /held/a.png.\n![b](/elsewhere/b.png)\n![gone](/held/gone.png)",
			}),
			(path) => path.startsWith("/held/"),
		);

		const copy = `/finished/${(await finished.list())[0]?.key}/a.png`;
		expect((await finished.read(copy.split("/")[2] ?? ""))?.plan).toBe(
			`![a](${copy}) and ${copy}.\n![b](/elsewhere/b.png)\n![gone](/held/gone.png)`,
		);
		expect(await fs.readBytes(copy)).toEqual(new Uint8Array([1]));
		expect(finished.owns(copy)).toBe(true);
	});

	it("names a copy apart when two files share a name", async () => {
		await finished.record(
			ended(6, "2026-10-01T06:00:00.000Z", {
				plan: "![one](/held/a.png) ![two](/held/two/a.png)",
			}),
			() => true,
		);

		const dir = `/finished/${(await finished.list())[0]?.key}`;
		expect((await finished.read(dir.slice("/finished/".length)))?.plan).toBe(
			`![one](${dir}/a.png) ![two](${dir}/2-a.png)`,
		);
		expect(await fs.readBytes(`${dir}/2-a.png`)).toEqual(new Uint8Array([2]));
	});

	it("drops the files of one it no longer has room for", async () => {
		finished = new Finished("/finished", fs, 1);
		await finished.record(
			ended(1, "2026-10-01T01:00:00.000Z", { plan: "![a](/held/a.png)" }),
			() => true,
		);
		const [first] = await finished.list();

		await finished.record(ended(2, "2026-10-01T02:00:00.000Z"));

		expect(await fs.exists(`/finished/${first?.key}/a.png`)).toBe(false);
	});

	it("owns only the files kept with one, not its record or a way out", () => {
		expect(finished.owns("/finished/1-2/a.png")).toBe(true);
		expect(finished.owns("/finished/1-2.md")).toBe(false);
		expect(finished.owns("/finished/1-2/deeper/a.png")).toBe(false);
		expect(finished.owns("/finished/1-2/../../etc/passwd")).toBe(false);
		expect(finished.owns("/finished/x/a.png")).toBe(false);
		expect(finished.owns("/elsewhere/1-2/a.png")).toBe(false);
	});

	it("reads nothing outside its folder", async () => {
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
