import { describe, expect, it, setDefaultTimeout } from "bun:test";
import { join } from "node:path";
import { add } from "./add";
import { claim } from "./claim";
import { escalate } from "./escalate";
import { merge } from "./merge";
import { PLAN_FILE } from "./plan";
import { remove } from "./remove";
import { retry } from "./retry";
import { Testing } from "./testing";

// Real git in a repo of its own, as in merge.test.ts.
setDefaultTimeout(30_000);

describe.concurrent("outcomes", () => {
	it("writes down a merged task's rounds and failed merges, past a retry", async () => {
		await using deps = await Testing.open();
		deps.config.mergeRetryCount = 1;
		await add(deps, "alpha");
		const worktree = (await deps.service.find("alpha")).path;
		await deps.commit(worktree, "alpha.txt", "alpha\n", "add alpha");
		await deps.finish(worktree);

		await escalate(deps, "which name?", worktree);
		await claim(deps, "alpha");
		deps.config.preMerge = "exit 1";
		await expect(merge(deps, worktree)).toBail("tests_failed");
		await escalate(deps, "the gate keeps failing", worktree);
		await retry(deps, "alpha");
		await claim(deps, "alpha");
		await escalate(deps, "look at the diff", worktree, { review: true });
		await claim(deps, "alpha");
		deps.config.preMerge = "true";
		await merge(deps, worktree);

		expect(await deps.outcomes.list()).toMatchObject([
			{
				project: deps.root,
				task: "alpha",
				base: "main",
				ended: "merged",
				questionRounds: 2,
				reviewRounds: 1,
				failedMerges: 1,
				conversation: null,
				agent: null,
				model: null,
			},
		]);
	});

	it("writes down the picks overturned, the systems touched, failures by reason and the wait", async () => {
		await using deps = await Testing.open();
		await deps.commit(
			deps.root,
			"arbor.config.ts",
			'export default { systems: { mixer: { globs: ["mixer-*.ts"] }, docs: { globs: ["*.md"] } } };\n',
			"name systems",
		);
		await add(deps, "alpha");
		const worktree = (await deps.service.find("alpha")).path;
		await deps.commit(worktree, "mixer-gain.ts", "gain\n", "add gain");
		// Trunk moves the same file, so the first merge conflicts.
		await deps.commit(deps.root, "mixer-gain.ts", "trunk\n", "trunk gain");
		await deps.finish(worktree);
		await expect(merge(deps, worktree)).toBail("conflict");
		await deps.gitCli(worktree, "rebase", "--abort");
		await deps.gitCli(worktree, "reset", "--hard", "main");
		await deps.commit(worktree, "mixer-fade.ts", "fade\n", "add fade");
		await deps.fs.write(
			join(worktree, PLAN_FILE),
			[
				"# alpha",
				"",
				"## Blocked",
				"",
				"- [x] 1. Which name? → (a)",
				"  - (a) gain (chosen)",
				"  - (b) level",
				"- [x] 2. Which curve? → b",
				"  - (a) linear (chosen)",
				"  - (b) log",
				"- [x] 3. Does it sound right? → yes",
				"- [x] 4. Which default? → moot: gone",
				"  - (a) on (chosen)",
				"  - (b) off",
				"- [x] 5. Which unit? → a, but in dB",
				"  - (a) decibels (chosen)",
				"  - (b) ratio",
				"- [x] 6. Which knob? → a",
				"  - (a) round (chosen)",
				"  - (b) slider",
				"  → and keep it small",
				"",
			].join("\n"),
		);
		await escalate(deps, "which name?", worktree);
		await claim(deps, "alpha");
		const resumed = (await deps.service.find("alpha")).state?.escalations;
		await merge(deps, worktree);

		expect(resumed).toEqual([
			{
				reason: "which name?",
				at: expect.any(String),
				resumedAt: expect.any(String),
			},
		]);
		const [outcome] = await deps.outcomes.list();
		expect(outcome).toMatchObject({
			failedMerges: 1,
			failedMergesBy: { conflict: 1 },
			questionsAsked: 6,
			picksAsked: 4,
			picksOverturned: 1,
			picksAmended: 2,
			systems: ["mixer"],
			removedFor: null,
		});
		expect(outcome?.waitedMs).toBeGreaterThanOrEqual(0);
	});

	it("writes down a removed task, and nothing for one never recorded", async () => {
		await using deps = await Testing.open();
		await add(deps, "alpha");

		await remove(deps, "alpha", { reason: "moot" });
		await deps.gitCli(deps.root, "branch", "task/stray");
		await remove(deps, "stray");

		expect(await deps.outcomes.list()).toMatchObject([
			{
				task: "alpha",
				ended: "removed",
				questionRounds: 0,
				failedMerges: 0,
				removedFor: "moot",
				waitedMs: 0,
			},
		]);
	});

	it("names the conversation from arbor dev that ended it, and what it ran", async () => {
		await using deps = await Testing.open();
		deps.proc.env = { ...deps.proc.env, ARBOR_CONVERSATION: "c1" };
		const model = (current: string) => ({
			kind: "settings",
			settings: [
				{
					id: "model",
					category: "model",
					current,
					options: [
						{ value: "default", name: "Default", description: "Opus 5.5" },
						{ value: "sonnet", name: "Sonnet 5.5", description: null },
					],
				},
			],
		});
		await deps.fs.mkdir(join(deps.arborDir, "conversations"));
		await deps.fs.write(
			join(deps.arborDir, "conversations", "c1.jsonl"),
			[
				{ kind: "start", id: "c1", agent: "claude", task: null },
				model("sonnet"),
				{ kind: "prompt", text: "go" },
				model("default"),
			]
				.map((line) => `${JSON.stringify(line)}\n`)
				.join(""),
		);
		await add(deps, "alpha");
		await add(deps, "beta");

		await remove(deps, "alpha");
		await remove(deps, "beta", { conversation: "gone" });

		expect(await deps.outcomes.list()).toMatchObject([
			{ task: "alpha", conversation: "c1", agent: "claude", model: "Opus 5.5" },
			{ task: "beta", conversation: "gone", agent: null, model: null },
		]);
	});
});
