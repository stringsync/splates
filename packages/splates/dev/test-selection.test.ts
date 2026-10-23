import { beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { FakePs } from "webappwiz/system/testing";
import { test as runTests, type TestOptions } from "./test";

describe("focused development tests", () => {
	let ps: FakePs;
	let opts: TestOptions;

	beforeEach(() => {
		ps = new FakePs();
		ps.platform = "linux";
		opts = { ps, log: new MemoryLogger() };
	});

	it("runs changed tests here with one worker", async () => {
		await runTests({ ...opts, changed: true });

		expect(ps.getCalls()).toEqual([
			expect.stringMatching(
				/^bun test --pass-with-no-tests --parallel=1 .* --changed --path-ignore-patterns=evals\/\*\* --path-ignore-patterns=packages\/web\/\*\*$/,
			),
			expect.stringMatching(
				/^bun test --pass-with-no-tests --parallel=1 .* --changed --preload=\.\/packages\/web\/test-preload\.ts /,
			),
		]);
	});

	it("combines a reference, file filters and a test-name regex", async () => {
		await runTests({
			...opts,
			since: "main",
			files: [
				"packages/server/example.test.ts",
				"packages/web/example.test.tsx",
			],
			testNamePattern: "retries|timeouts",
			workers: 2,
		});

		const selected =
			/--parallel=2 .*--changed=main --test-name-pattern retries\|timeouts .*packages\/server\/example\.test\.ts packages\/web\/example\.test\.tsx$/;
		expect(ps.getCalls()).toEqual([
			expect.stringMatching(selected),
			expect.stringMatching(selected),
		]);
	});

	it("runs an explicit file here without asking a runner", async () => {
		await runTests({ ...opts, files: ["packages/splates/dev/test.test.ts"] });

		expect(ps.getCalls()).toHaveLength(2);
		expect(ps.getCalls()[0]).toEndWith("packages/splates/dev/test.test.ts");
		expect(ps.getCalls()[0]).not.toContain("--changed");
	});

	it("keeps an eval file filter from also selecting the entire eval directory", async () => {
		await runTests({
			...opts,
			evals: true,
			files: ["evals/splates-skill/resources.probes.test.ts"],
		});

		expect(ps.getCalls()).toHaveLength(1);
		expect(ps.getCalls()[0]).toContain("--path-ignore-patterns=packages/**");
		expect(ps.getCalls()[0]).toEndWith(
			"evals/splates-skill/resources.probes.test.ts",
		);
		expect(ps.getCalls()[0]).not.toContain(" evals/ ");
	});

	it("can filter only by test name and still limits the worker count", async () => {
		await runTests({ ...opts, testNamePattern: "one case" });

		expect(ps.getCalls()[0]).toContain("--parallel=1");
		expect(ps.getCalls()[0]).toContain("--test-name-pattern one case");
	});

	it("runs a full suite on a runner here, on the CPUs its job was given", async () => {
		ps.setEnv({ SPLATES_CORES: "8" });
		await runTests(opts);

		expect(ps.getCalls()).toHaveLength(2);
		expect(ps.getCalls()[0]).toContain("--parallel=8");
	});

	it("reports a failing focused test", async () => {
		ps.simulate(async () => 1);

		await expect(runTests({ ...opts, changed: true })).rejects.toThrow(
			"Tests failed",
		);
	});
});
