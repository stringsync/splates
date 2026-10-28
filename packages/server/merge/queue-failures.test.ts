import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { FailedTest } from "../tasks";
import { Testing } from "../testing";
import { queueFailedTests } from "./queue-failures";

const TIMED_OUT = "^ this test timed out after 30000ms.";

function timedOut(name: string, file: string): FailedTest {
	return { name, file, message: TIMED_OUT };
}

describe("queueFailedTests", () => {
	let deps: Testing;
	beforeEach(async () => {
		deps = await Testing.open();
	});
	afterEach(async () => {
		await deps[Symbol.asyncDispose]();
	});

	it("queues a task per test when the gate was inconclusive", async () => {
		await queueFailedTests(
			deps,
			"alpha",
			[
				{ name: "renders a", message: "size 932x20245 != baseline" },
				{ name: "renders b", message: "size 932x20245 != baseline" },
			],
			"inconclusive",
		);

		const subjects = (await deps.tasks.all()).map((each) => each.subject);
		expect(subjects.sort()).toEqual([
			"Tests failed: renders a",
			"Tests failed: renders b",
		]);
	});

	it("folds tests failing together on the environment into one task naming each", async () => {
		await queueFailedTests(
			deps,
			"alpha",
			[
				timedOut("App's feed > keeps Power", "packages/web/app-feed.test.tsx"),
				timedOut(
					"App's setup > starts an agent",
					"packages/web/app-setup.test.tsx",
				),
				{ name: "Unhandled error between tests", message: "" },
			],
			"environment",
		);

		const [task, ...rest] = await deps.tasks.all();
		expect(rest).toEqual([]);
		expect(task?.subject).toBe(
			"Tests failed together in `alpha`'s gate: 3 tests (environment)",
		);
		expect(task?.text).toContain("Attribution: environment");
		expect(task?.text).toContain(
			`- App's feed > keeps Power (packages/web/app-feed.test.tsx): ${TIMED_OUT}`,
		);
		expect(task?.text).toContain(
			`- App's setup > starts an agent (packages/web/app-setup.test.tsx): ${TIMED_OUT}`,
		);
		expect(task?.text).toEndWith("- Unhandled error between tests");
	});

	it("folds several flakes the same way, and queues the event once across retries", async () => {
		const failed = [
			timedOut("one", "one.test.ts"),
			timedOut("two", "two.test.ts"),
		];
		await queueFailedTests(deps, "alpha", failed, "flake");
		await queueFailedTests(deps, "alpha", failed, "flake");

		expect((await deps.tasks.all()).map((task) => task.subject)).toEqual([
			"Tests failed together in `alpha`'s gate: 2 tests (flake)",
		]);
	});

	it("queues a task per test when the failures are the code's", async () => {
		await queueFailedTests(
			deps,
			"alpha",
			[timedOut("one", "one.test.ts"), timedOut("two", "two.test.ts")],
			"task",
		);

		expect((await deps.tasks.all()).map((task) => task.subject)).toEqual([
			"Tests failed: one",
			"Tests failed: two",
		]);
	});

	it("names a lone flake by its test", async () => {
		await queueFailedTests(
			deps,
			"alpha",
			[timedOut("one", "one.test.ts")],
			"flake",
		);

		expect((await deps.tasks.all()).map((task) => task.subject)).toEqual([
			"Tests failed: one",
		]);
	});
});
