import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { ensure } from "core/assert";
import { Duration, SystemWallClock } from "core/time";
import { FakeWallClock } from "core/time/testing";
import { addedFacts } from "../board";
import { NoopJournal } from "../records";
import type { FailedTest } from "../tasks";
import { Testing } from "../testing";
import { queueFailedTests } from "./queue-failures";

describe("queueFailedTests", () => {
	let deps: Testing;
	beforeEach(async () => {
		deps = await Testing.open();
	});
	afterEach(async () => {
		await deps[Symbol.asyncDispose]();
	});

	it.each(["task", "inconclusive"] as const)(
		"leaves %s failures with the merge attempt",
		async (kind) => {
			await queueFailedTests(deps, "alpha", [one, two], kind);
			expect(await deps.tasks.all()).toEqual([]);
		},
	);

	it("keeps a confirmed trunk failure actionable", async () => {
		await queueFailedTests(deps, "alpha", [one], "trunk");
		expect((await deps.tasks.all()).map((item) => item.subject)).toEqual([
			"Tests failed: one",
		]);
	});

	it.each(["environment", "trunk"] as const)(
		"groups simultaneous %s failures across different tasks",
		async (kind) => {
			await queueFailedTests(deps, "alpha", [one, two], kind);
			await queueFailedTests(deps, "beta", [two, one], kind);
			const all = await deps.tasks.all();
			expect(all).toHaveLength(1);
			expect(all[0]?.text).toContain("one.test.ts");
			expect(all[0]?.text).toContain("two.test.ts");
			expect(all[0]?.text).toContain("Investigate them as one incident");
			expect(all[0]?.text).toContain("Found while merging `beta`");
		},
	);

	it("records the first flake without creating a task", async () => {
		await queueFailedTests(deps, "alpha", [one], "flake");
		await flake(deps, "alpha");
		expect(await deps.tasks.all()).toEqual([]);
		expect((await deps.journal.tail(1))[0]).toMatchObject({
			failureAttribution: "flake",
			failedTests: [one],
		});
	});

	it("requires an independent task and the same file for a repeated flake", async () => {
		await flake(deps, "alpha");
		await queueFailedTests(deps, "alpha", [one], "flake");
		await queueFailedTests(
			deps,
			"beta",
			[{ ...one, file: "other.test.ts" }],
			"flake",
		);
		expect(await deps.tasks.all()).toEqual([]);
	});

	it("creates one incident for flakes repeated on an independent task", async () => {
		await flake(deps, "alpha", [one, two]);
		await queueFailedTests(deps, "beta", [one, two], "flake");
		const all = await deps.tasks.all();
		expect(all).toHaveLength(1);
		expect(all[0]?.subject).toStartWith("Flaky tests together:");
		expect(all[0]?.text).toContain("Treat it as flaky");
	});

	it("expires old flake evidence", async () => {
		await flake(deps, "alpha");
		const wall = new FakeWallClock(new SystemWallClock().now());
		wall.advance(Duration.days(8));
		await queueFailedTests({ ...deps, wall }, "beta", [one], "flake");
		expect(await deps.tasks.all()).toEqual([]);
	});

	it("updates an existing incident when only some failures recur", async () => {
		await queueFailedTests(deps, "alpha", [one, two], "trunk");
		await queueFailedTests(deps, "beta", [two], "environment");
		await queueFailedTests(deps, "gamma", [one], "trunk");
		const all = await deps.tasks.all();
		expect(all).toHaveLength(1);
		expect(all[0]?.text).toContain("Found while merging `gamma`");
		expect(all[0]?.text.match(/### Latest recurrence/g)).toHaveLength(1);
	});

	it("does not recreate a recently removed failure under another attribution", async () => {
		await queueFailedTests(deps, "alpha", [one, two], "trunk");
		const item = ensure.defined((await deps.tasks.all())[0]);
		await close(deps, item.id);
		await queueFailedTests(deps, "beta", [one], "environment");
		expect(await deps.tasks.all()).toEqual([]);
		const wall = new FakeWallClock(new SystemWallClock().now());
		wall.advance(Duration.days(8));
		await queueFailedTests({ ...deps, wall }, "gamma", [one], "trunk");
		expect(await deps.tasks.all()).toHaveLength(1);
	});

	it("honors recently removed tasks created before failure keys existed", async () => {
		const item = await deps.journal.record(
			"task add",
			"alpha",
			() => deps.tasks.add("Tests failed: one", "alpha"),
			addedFacts,
		);
		await close(deps, item.id);
		await queueFailedTests(deps, "beta", [one], "trunk");
		expect(await deps.tasks.all()).toEqual([]);
	});

	it("keeps same-named tests in different files distinct", async () => {
		await queueFailedTests(deps, "alpha", [one], "trunk");
		await queueFailedTests(
			deps,
			"beta",
			[{ ...one, file: "other.test.ts" }],
			"trunk",
		);
		expect(await deps.tasks.all()).toHaveLength(2);
	});

	it("suppresses a recently merged failure task", async () => {
		await queueFailedTests(deps, "alpha", [one], "trunk");
		const item = ensure.defined((await deps.tasks.all())[0]);
		await deps.journal.record("add", "fix-one", async () => {}, {
			base: "main",
			tasks: [item.id],
			goal: null,
			subjects: [item.subject],
			agent: null,
			model: null,
		});
		await item.remove("abc123");
		await deps.journal.record("merge", "fix-one", async () => {}, {
			base: "main",
			commit: "abc123",
			files: [],
			attemptsLeft: 5,
			failedTests: [],
		});
		await queueFailedTests(deps, "beta", [one], "trunk");
		expect(await deps.tasks.all()).toEqual([]);
	});

	it("does not guess flake recurrence without a journal", async () => {
		await queueFailedTests(
			{ tasks: deps.tasks, log: deps.log, journal: new NoopJournal() },
			"alpha",
			[one],
			"flake",
		);
		expect(await deps.tasks.all()).toEqual([]);
	});
});

const one = { name: "one", file: "one.test.ts", message: "timed out" };
const two = { name: "two", file: "two.test.ts", message: "timed out" };

async function flake(
	deps: Testing,
	task: string,
	failed: FailedTest[] = [one],
) {
	await deps.journal.record("merge", task, async () => {}, {
		base: "main",
		commit: "abc123",
		files: [],
		attemptsLeft: 5,
		failedTests: failed,
		failureAttribution: "flake",
	});
}

async function close(deps: Testing, id: number) {
	const item = await deps.tasks.find(id);
	await deps.journal.record("task remove", null, () => item.remove(), {
		tasks: [{ id, subject: item.subject }],
	});
}
