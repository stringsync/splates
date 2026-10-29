import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	setDefaultTimeout,
} from "bun:test";
import { Duration } from "webappwiz/time";
import { FakeClock } from "webappwiz/time/testing";
import type { Facts } from "../records";
import { add } from "../tasks";
import { Shell } from "../terminal";
import { Testing } from "../testing";
import { merge } from "./merge";

setDefaultTimeout(30_000);

const CHECK = `import { test, expect } from "bun:test";
test("mode is good", async () => {
  const mode = (await Bun.file("mode.txt").text()).trim();
  if (mode === "flake") {
    const marker = Bun.file(process.env.SPLATES_TEST_REPORT + ".flaked");
    if (!(await marker.exists())) {
      await Bun.write(marker, "seen");
      expect(false).toBe(true);
    }
  } else {
    expect(mode).toBe("good");
  }
});
`;
const GATE =
	'bun test --timeout 30000 --reporter=junit --reporter-outfile="$SPLATES_TEST_REPORT"';

describe("merge failure attribution", () => {
	let deps: Testing;
	let tree: string;
	beforeEach(async () => {
		deps = await Testing.open();
		await deps.commit(deps.root, "checks.test.ts", CHECK, "add checks");
		await deps.commit(deps.root, "mode.txt", "good", "good mode");
		await add(deps, "alpha");
		tree = (await deps.service.find("alpha")).path;
		await deps.finish(tree);
		deps.config.preMerge = GATE;
	});
	afterEach(async () => {
		await deps[Symbol.asyncDispose]();
	});
	// scry-ignore simple-test-setup: only this case measures attribution time; the other cases share the repository setup above.
	it("charges only a failure reproduced on the task after passing on the exact base", async () => {
		await deps.commit(tree, "mode.txt", "bad", "break mode");
		const before = await deps.git.head(tree);
		const clock = new FakeClock();
		class TimedShell extends Shell {
			override async run(...args: Parameters<Shell["run"]>) {
				try {
					return await super.run(...args);
				} finally {
					clock.advance(Duration.ms(10));
				}
			}
		}
		const shell = new TimedShell({ ps: deps.ps });
		// Include baseline dependency preparation as well as all three runs.
		deps.config.postRewrite = "true";
		const facts: Partial<Facts["merge"]> = {};

		await expect(merge({ ...deps, clock, shell }, tree, facts)).toBail(
			"tests_failed",
			{
				message: "no attempt spent: this is the first time it failed",
			},
		);
		expect((await deps.service.find("alpha")).mergeAttempts).toBe(0);
		// The same tests on the same base are the agent merging without a fix.
		const again: Partial<Facts["merge"]> = {};
		await expect(merge({ ...deps, clock, shell }, tree, again)).toBail(
			"tests_failed",
			{
				message:
					"one merge attempt was spent: the same tests failed on the same base as last time",
			},
		);

		expect(again).toMatchObject({
			failureAttribution: "task",
			attemptsLeft: 1,
			retests: 0,
		});
		expect((await deps.service.find("alpha")).mergeAttempts).toBe(1);
		expect(await deps.git.head(tree)).toBe(before);
		expect(
			await deps.gitCli(deps.root, "worktree", "list", "--porcelain"),
		).not.toContain("splates-attribution");
		expect(await deps.fs.exists(deps.lockPath)).toBe(false);
	});

	it("charges the same failing tests on a base that moved", async () => {
		await deps.commit(tree, "mode.txt", "bad", "break mode");
		await expect(merge(deps, tree)).toBail("tests_failed");
		await deps.commit(deps.root, "other.txt", "x", "trunk moves");
		await expect(merge(deps, tree)).toBail("tests_failed", {
			message: "the same tests failed as last time",
		});
		expect((await deps.service.find("alpha")).mergeAttempts).toBe(1);
	});

	it("holds trunk-red without charging and deduplicates its follow-up across retries", async () => {
		await deps.commit(deps.root, "mode.txt", "bad", "bad mode on trunk");
		await deps.commit(tree, "alpha.txt", "unrelated", "add alpha");
		const trunkBefore = await deps.git.head(deps.root);
		const facts: Partial<Facts["merge"]> = {};

		await expect(merge(deps, tree, facts)).toBail("tests_failed", {
			message: "no merge attempt was spent",
		});
		await expect(merge(deps, tree)).toBail("tests_failed");

		expect(facts).toMatchObject({
			failureAttribution: "trunk",
			attemptsLeft: 2,
		});
		expect((await deps.service.find("alpha")).mergeAttempts).toBe(0);
		expect(await deps.git.head(deps.root)).toBe(trunkBefore);
		expect((await deps.tasks.all()).map((task) => task.subject)).toEqual([
			"Tests failed: mode is good",
		]);
		expect(
			(await deps.journal.tail(10)).filter(
				(event) => event.action === "task add",
			),
		).toHaveLength(1);
	});

	it("lands a flake only after the full gate passes again, without spending an attempt", async () => {
		await deps.commit(tree, "mode.txt", "flake", "flaky mode");
		const facts: Partial<Facts["merge"]> = {};

		await merge(deps, tree, facts);

		expect(facts).toMatchObject({
			failureAttribution: "flake",
			attemptsLeft: 2,
			commit: expect.any(String),
		});
		expect(await deps.fs.read(`${deps.root}/mode.txt`)).toBe("flake");
		expect(await deps.tasks.all()).toEqual([]);
	});

	it("holds when a selective flake retry passes but the full gate still fails", async () => {
		await deps.commit(tree, "mode.txt", "flake", "flaky mode");
		deps.config.preMerge = `${GATE} && exit 9`;
		const before = await deps.git.head(deps.root);
		const facts: Partial<Facts["merge"]> = {};

		await expect(merge(deps, tree, facts)).toBail("tests_failed");

		expect(facts).toMatchObject({
			failureAttribution: "environment",
			attemptsLeft: 2,
		});
		expect(await deps.git.head(deps.root)).toBe(before);
		expect((await deps.service.find("alpha")).mergeAttempts).toBe(0);
	});

	it("does not charge setup failures or reuse an earlier attempt's report", async () => {
		await deps.commit(tree, "alpha.txt", "alpha", "add alpha");
		const dir = await deps.git.out(tree, "rev-parse", "--absolute-git-dir");
		await deps.fs.write(
			`${dir}/splates-test-report.xml`,
			'<testsuites name="bun test"><testsuite><testcase name="old" file="old.test.ts"><failure/></testcase></testsuite></testsuites>',
		);
		deps.config.postRewrite = "echo install-failed; exit 1";
		const facts: Partial<Facts["merge"]> = {};

		await expect(merge(deps, tree, facts)).toBail("tests_failed", {
			message: "install-failed",
		});

		expect(facts).toMatchObject({
			failureAttribution: "inconclusive",
			attemptsLeft: 2,
			failedTests: [],
		});
		expect((await deps.service.find("alpha")).mergeAttempts).toBe(0);
		expect(await deps.fs.exists(deps.lockPath)).toBe(false);
	});

	it("does not charge a failed baseline setup and removes its detached checkout", async () => {
		await deps.commit(tree, "mode.txt", "bad", "break mode");
		await deps.commit(tree, "task-only.txt", "here", "add task marker");
		deps.config.postRewrite = "test -f task-only.txt";
		const facts: Partial<Facts["merge"]> = {};

		await expect(merge(deps, tree, facts)).toBail("tests_failed");

		expect(facts).toMatchObject({
			failureAttribution: "inconclusive",
			attemptsLeft: 2,
		});
		expect((await deps.service.find("alpha")).mergeAttempts).toBe(0);
		expect(
			await deps.gitCli(deps.root, "worktree", "list", "--porcelain"),
		).not.toContain("splates-attribution");
		expect(await deps.fs.exists(deps.lockPath)).toBe(false);
	});

	it("holds an unsupported report without charging", async () => {
		await deps.commit(tree, "alpha.txt", "alpha", "add alpha");
		deps.config.preMerge = `printf '<testsuites><testsuite><testcase name="broken" file="a.test.ts"><failure/></testcase></testsuite></testsuites>' > "$SPLATES_TEST_REPORT"; exit 1`;
		const facts: Partial<Facts["merge"]> = {};

		await expect(merge(deps, tree, facts)).toBail("tests_failed");

		expect(facts).toMatchObject({
			failureAttribution: "inconclusive",
			attemptsLeft: 2,
		});
		expect((await deps.service.find("alpha")).mergeAttempts).toBe(0);
	});

	it("names the commits that landed since the task last rebased, with the task each came from", async () => {
		await deps.commit(
			deps.root,
			"lib.ts",
			'export const greeting = "hi";\n',
			"add lib",
		);
		await deps.commit(
			tree,
			"alpha.test.ts",
			'import { expect, test } from "bun:test";\nimport { greeting } from "./lib";\ntest("greets", () => expect(greeting).toBe("hi"));\n',
			"test the greeting",
		);
		await add(deps, "beta");
		const beta = (await deps.service.find("beta")).path;
		await deps.commit(
			beta,
			"lib.ts",
			'export const greeting = "hello";\n',
			"say hello",
		);
		await deps.finish(beta);
		await merge(deps, beta);
		await deps.commit(deps.root, "other.txt", "other\n", "add other");
		const facts: Partial<Facts["merge"]> = {};

		await expect(merge(deps, tree, facts)).toBail("tests_failed", {
			message: ["moved to", "files you changed:", "beta say hello"],
		});

		expect(facts.landed).toMatchObject({
			total: 3,
			filtered: true,
			commits: [
				{ task: "beta", subject: "say hello" },
				{ task: null, subject: "add lib" },
			],
		});
	});
});
