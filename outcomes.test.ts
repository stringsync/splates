import { describe, expect, it, setDefaultTimeout } from "bun:test";
import { join } from "node:path";
import { add } from "./add";
import { claim } from "./claim";
import { escalate } from "./escalate";
import { merge } from "./merge";
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

	it("writes down a removed task, and nothing for one never recorded", async () => {
		await using deps = await Testing.open();
		await add(deps, "alpha");

		await remove(deps, "alpha");
		await deps.gitCli(deps.root, "branch", "task/stray");
		await remove(deps, "stray");

		expect(await deps.outcomes.list()).toMatchObject([
			{ task: "alpha", ended: "removed", questionRounds: 0, failedMerges: 0 },
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
