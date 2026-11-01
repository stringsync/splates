import { join } from "node:path";
import { TicketedLock } from "../server/ticketed-lock";
import { add } from "../tasks";
import { Testing } from "../testing";

const CHECK = `import { test, expect } from "bun:test";
test("mode is good", async () => {
  expect((await Bun.file("mode.txt").text()).trim()).toBe("good");
});
`;
/** Stands in for `bun test`, which costs a process spawn per gate (the retests of a failure still run `CHECK` for real): passes on "good" mode.txt and reports like the real reporter, failing the one test "mode is good" otherwise. */
const GATE = `if [ "$(cat mode.txt)" = good ]; then
  echo '<testsuites name="bun test"><testsuite name="checks.test.ts" file="checks.test.ts"><testcase name="mode is good" time="0.01" file="checks.test.ts"/></testsuite></testsuites>' > "$SPLATES_TEST_REPORT"
else
  echo '<testsuites name="bun test"><testsuite name="checks.test.ts" file="checks.test.ts"><testcase name="mode is good" file="checks.test.ts"><failure message="expected good"/></testcase></testsuite></testsuites>' > "$SPLATES_TEST_REPORT"
  exit 1
fi`;

/** A repository with two finished-able tasks, alpha and beta, and the premerge lock as the machine serves it. */
export async function openBatch() {
	const deps = await Testing.open();
	/** First come, first served, so alpha leads. */
	const premerge = new TicketedLock(
		deps.premerge,
		join(deps.splatesHome, "premerge.queue"),
		{ fs: deps.fs, ps: deps.ps, log: deps.log, pollMs: 20 },
	);
	await deps.commit(deps.root, "checks.test.ts", CHECK, "add checks");
	await deps.commit(deps.root, "mode.txt", "good", "good mode");
	await add(deps, "alpha");
	const alpha = (await deps.service.find("alpha")).path;
	await add(deps, "beta");
	const beta = (await deps.service.find("beta")).path;
	deps.config.preMerge = GATE;
	/** Resolves once `task` has offered itself to a batch. */
	const offered = async (task: string): Promise<void> => {
		for (let i = 0; i < 500; i++) {
			if (deps.line.has(task)) {
				return;
			}
			await Bun.sleep(10);
		}
		throw new Error(`${task} never offered itself`);
	};
	return { deps, alpha, beta, premerge, offered };
}
