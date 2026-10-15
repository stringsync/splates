import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { Exit } from "./exit";
import { Journal } from "./journal";
import { log } from "./log";
import { Testing } from "./testing";

describe("log", () => {
	let deps: Testing;

	beforeEach(async () => {
		deps = await Testing.open();
	});

	afterEach(() => deps.disposeAsync());

	it("records how each command ended, refusals included", async () => {
		await deps.journal.record("retry", "alpha", async () => {});
		await expect(
			deps.journal.record("merge", "alpha", () =>
				Promise.reject(new Exit("tests_failed", "nope")),
			),
		).toBail("tests_failed");

		await log(deps);

		const out = deps.out();
		expect(out).toContain("retry");
		expect(out).toContain("alpha");
		expect(out).toContain("ok");
		expect(out).toContain("tests_failed");

		// Newest last, and --count trims from the front.
		deps.log.clear();
		await log(deps, { count: 1, json: true });
		expect(JSON.parse(deps.out())).toMatchObject([
			{ action: "merge", task: "alpha", reason: "tests_failed" },
		]);
	});

	it("logs a wait as it begins, then how it ended, naming the first", async () => {
		const until = new Date(Date.now() + 60_000).toISOString();
		await expect(
			deps.journal.waiting("wait", "alpha", { until }, () =>
				Promise.reject(new Exit("timeout", "still working")),
			),
		).toBail("timeout");

		const [began, ended] = await deps.journal.tail(2);
		expect(began).toMatchObject({
			action: "wait",
			task: "alpha",
			reason: null,
			until,
			began: null,
		});
		expect(ended).toMatchObject({
			action: "wait",
			task: "alpha",
			reason: "timeout",
			until,
			began: began?.id,
		});
	});

	it("moves a full log aside and still reads back across both", async () => {
		// Room for two, so the second event rotates the file.
		const journal = new Journal(join(deps.arborDir, "log.jsonl"), 2, {
			fs: deps.fs,
			ps: deps.ps,
		});
		await journal.record("retry", "a", async () => {});
		await journal.record("retry", "b", async () => {});
		await journal.record("retry", "c", async () => {});

		expect(await deps.fs.readdir(join(deps.arborDir, "log"))).toHaveLength(1);
		expect((await journal.tail(10)).map((event) => event.task)).toEqual([
			"a",
			"b",
			"c",
		]);
		expect((await journal.tail(2)).map((event) => event.task)).toEqual([
			"b",
			"c",
		]);
		expect(await journal.tail(0)).toEqual([]);

		await log({ journal, log: deps.log }, { json: true });
		expect(JSON.parse(deps.out())).toHaveLength(3);
	});

	it("loses no event to writers at the same instant", async () => {
		await Promise.all(
			Array.from({ length: 20 }, (_, i) =>
				deps.journal.record("retry", `t${i}`, async () => {}),
			),
		);

		expect(await deps.journal.tail(100)).toHaveLength(20);
	});

	it("stamps each event with the conversation that ran it", async () => {
		await deps.journal.record("retry", "a", async () => {});
		deps.proc.env.ARBOR_CONVERSATION = "c1";
		await deps.journal.record("retry", "b", async () => {});
		delete deps.proc.env.ARBOR_CONVERSATION;

		expect(
			(await deps.journal.tail(2)).map((event) => event.conversation),
		).toEqual([null, "c1"]);
	});

	it("keeps the facts asked of a refused command, and drops those it never learned", async () => {
		const asked = {
			base: "main",
			todos: [3],
			goal: null,
			subjects: [],
			agent: "claude",
			model: "sonnet",
		};
		await expect(
			deps.journal.record(
				"add",
				"a",
				() => Promise.reject(new Exit("exists", "taken")),
				asked,
			),
		).toBail("exists");
		await expect(
			deps.journal.record(
				"claim",
				"a",
				() => Promise.reject(new Exit("not_found", "gone")),
				(out: { escalated: boolean; tookOver: boolean }) => out,
			),
		).toBail("not_found");
		await deps.journal.record(
			"claim",
			"a",
			async () => ({ escalated: true, tookOver: false }),
			(out) => out,
		);

		const [add, refused, claimed] = await deps.journal.tail(3);
		expect(add).toMatchObject({ action: "add", reason: "exists", ...asked });
		expect(refused).not.toHaveProperty("escalated");
		expect(claimed).toMatchObject({ action: "claim", escalated: true });
	});

	it("says so plainly when nothing has happened", async () => {
		await log(deps);

		expect(deps.out()).toContain("nothing recorded yet");
	});
});
