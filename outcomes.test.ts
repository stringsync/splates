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

	it("writes down the picks overturned, the systems touched, failures by reason, the wait and the commits landed", async () => {
		await using deps = await Testing.open();
		await deps.commit(
			deps.root,
			"arbor.systems.ts",
			`export default ${JSON.stringify({ mixer: { globs: ["mixer-*.ts"] }, docs: { globs: ["*.md"] } })};\n`,
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
			commits: ["add fade"],
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

	it("counts the prompts said from each layout of the page while the task ran", async () => {
		await using deps = await Testing.open();
		deps.proc.env = { ...deps.proc.env, ARBOR_CONVERSATION: "c1" };
		await add(deps, "alpha");
		const during = new Date().toISOString();
		await deps.fs.mkdir(join(deps.arborDir, "conversations"));
		await deps.fs.write(
			join(deps.arborDir, "conversations", "c1.jsonl"),
			[
				{ kind: "start", id: "c1", agent: "claude", task: null },
				// Before the task, so another task's.
				{
					kind: "prompt",
					text: "hi",
					at: "2000-01-01T00:00:00.000Z",
					from: "phone",
				},
				{ kind: "prompt", text: "go", at: during, from: "phone" },
				{
					kind: "prompt",
					text: "and",
					at: during,
					from: "phone",
					queued: true,
				},
				{ kind: "prompt", text: "merge", at: during, from: "desktop" },
				// An agent's word, from no layout.
				{ kind: "prompt", text: "[ARBOR RESUME]", at: during },
			]
				.map((line) => `${JSON.stringify(line)}\n`)
				.join(""),
		);

		await remove(deps, "alpha");

		expect(await deps.outcomes.list()).toMatchObject([
			{ task: "alpha", promptsFrom: { phone: 2, desktop: 1 } },
		]);
	});

	it("keeps each gate failure with what it named, the budget running out once, and the size landed", async () => {
		await using deps = await Testing.open();
		deps.config.mergeRetryCount = 1;
		const worktree = await committed(deps, "one\ntwo\n");
		deps.config.preMerge = "echo '(fail) adds up [1.00ms]'; exit 1";
		await expect(merge(deps, worktree)).toBail("tests_failed");
		await expect(merge(deps, worktree)).toBail("budget_exhausted");
		await expect(merge(deps, worktree)).toBail("budget_exhausted");
		await escalate(deps, "the gate keeps failing", worktree);
		await retry(deps, "alpha");
		await claim(deps, "alpha");
		deps.config.preMerge = "true";
		await merge(deps, worktree);

		const [outcome] = await deps.outcomes.list();
		expect(outcome?.size).toEqual({ files: 1, added: 2, removed: 0 });
		expect(outcome?.findings).toEqual([
			{
				kind: "gate",
				reason: "tests_failed",
				at: expect.any(String),
				tests: ["adds up"],
				failures: [{ name: "adds up", message: "" }],
			},
			{ kind: "gate", reason: "budget_exhausted", at: expect.any(String) },
			{ kind: "retried", times: 1 },
		]);
		expect(outcome?.usage).toBeUndefined();
	});

	// scry-ignore simple-test-setup: each test opens its own repo with `await using`, as every test here does, since they run concurrently
	it("reads the task's own usage, working time and findings off its conversation", async () => {
		await using deps = await Testing.open();
		deps.proc.env = { ...deps.proc.env, ARBOR_CONVERSATION: "c1" };
		const worktree = await committed(deps, "one\n");
		const at = await stepsFromStart(deps);
		await logged(deps, [
			// Another task's turn, before this one began.
			{ kind: "prompt", text: "earlier", at: BEFORE },
			said("done", BEFORE),
			costing(2),
			{ kind: "usage", usage: { inputTokens: 100, outputTokens: 10 } },
			{ kind: "prompt", text: "go", at: at(0) },
			said("on it", at(1)),
			failed("t1", "bun test", at(2)),
			failed("t2", "bun test", at(3)),
			failed("t3", "bun test", at(3)),
			wrote(`${worktree}/alpha.txt`, 400, at(4)),
			{ kind: "stopped", at: at(5) },
			costing(3.5),
			{ kind: "usage", usage: { inputTokens: 40, outputTokens: 7 } },
		]);
		await judged(deps, {
			"merge-squashed": { passed: 1, failed: 3 },
			"report-titled": { passed: 4, failed: 1 },
		});

		await Bun.sleep(60);
		await merge(deps, worktree);

		const [outcome] = await deps.outcomes.list();
		expect(outcome?.usage).toEqual({
			input: 40,
			cached: 0,
			output: 7,
			cost: { amount: 1.5, currency: "USD" },
		});
		expect(outcome?.workedMs).toBe(40);
		expect(outcome?.findings).toEqual([
			{ kind: "stopped", at: at(5) },
			{ kind: "repeated_failure", command: "bun test", times: 3 },
			{ kind: "churn", edited: 400, landed: 1 },
			{ kind: "adherence", check: "merge-squashed", passed: 1, failed: 3 },
		]);
	});

	it("reads usage with no tokens out as never kept, since no turn the task ran ever counted", async () => {
		await using deps = await Testing.open();
		const line = (task: string, output: number) =>
			`${JSON.stringify({ task, usage: { input: 5, cached: 0, output, cost: null } })}\n`;
		await deps.fs.write(
			deps.outcomes.path,
			line("alpha", 0) + line("beta", 12),
		);

		const [alpha, beta] = await deps.outcomes.list();

		expect(alpha).not.toHaveProperty("usage");
		expect(beta?.usage?.output).toBe(12);
	});

	it("credits a task merged in its first turn with that turn's usage once the turn ends, beside the outcomes", async () => {
		await using deps = await Testing.open();
		deps.proc.env = { ...deps.proc.env, ARBOR_CONVERSATION: "c1" };
		const worktree = await committed(deps, "one\n");
		const at = await stepsFromStart(deps);
		const start = [
			{ kind: "prompt", text: "earlier", at: BEFORE },
			said("done", BEFORE),
			costing(2),
			{ kind: "usage", usage: { inputTokens: 100, outputTokens: 10 } },
			{ kind: "prompt", text: "go", at: at(0) },
			said("on it", at(1)),
		];
		await logged(deps, start);
		await Bun.sleep(20);
		await merge(deps, worktree);
		const [recorded] = await deps.outcomes.list();
		const ended = new Date(Date.now() + 10).toISOString();
		await logged(deps, [
			...start,
			said("merged", ended),
			costing(3.25),
			{ kind: "usage", usage: { inputTokens: 40, outputTokens: 7 } },
		]);

		const log = join(deps.arborDir, "conversations", "c1.jsonl");
		await deps.outcomes.creditTurn("c1", log, at(0), ended);
		await deps.outcomes.creditTurn("c2", log, at(0), ended);

		expect(recorded).not.toHaveProperty("usage");
		expect((await deps.outcomes.list())[0]?.usage).toEqual({
			input: 40,
			cached: 0,
			output: 7,
			cost: { amount: 1.25, currency: "USD" },
		});
		expect(
			(await deps.fs.read(deps.outcomes.path)).trim().split("\n"),
		).toHaveLength(1);
		expect(
			(await deps.fs.read(deps.outcomes.turnsPath)).trim().split("\n"),
		).toHaveLength(1);
	});
});

const BEFORE = "2000-01-01T00:00:00.000Z";

/** Task `alpha`, with `text` committed and its plan finished: ready to merge. */
async function committed(deps: Testing, text: string): Promise<string> {
	await add(deps, "alpha");
	const worktree = (await deps.service.find("alpha")).path;
	await deps.commit(worktree, "alpha.txt", text, "add alpha");
	await deps.finish(worktree);
	return worktree;
}

/** Times 10ms apart from when `alpha` began, all before a merge 60ms on. */
async function stepsFromStart(
	deps: Testing,
): Promise<(step: number) => string> {
	const began = Date.parse(
		(await deps.service.find("alpha")).state?.createdAt ?? "",
	);
	return (step) => new Date(began + step * 10).toISOString();
}

/** Writes conversation `c1`'s log: its start, then `lines`. */
async function logged(deps: Testing, lines: object[]): Promise<void> {
	await deps.fs.mkdir(join(deps.arborDir, "conversations"));
	await deps.fs.write(
		join(deps.arborDir, "conversations", "c1.jsonl"),
		[{ kind: "start", id: "c1", agent: "claude", task: null }, ...lines]
			.map((line) => `${JSON.stringify(line)}\n`)
			.join(""),
	);
}

/** Writes `c1`'s skill checks as last judged. */
async function judged(
	deps: Testing,
	scores: Record<string, { passed: number; failed: number }>,
): Promise<void> {
	await deps.fs.write(
		join(deps.arborHome, "adherence.jsonl"),
		`${JSON.stringify({ conversation: "c1", project: deps.root, agent: "claude", skill: null, at: BEFORE, scores })}\n`,
	);
}

function said(text: string, at: string): object {
	return {
		kind: "update",
		at,
		update: {
			sessionUpdate: "agent_message_chunk",
			content: { type: "text", text },
		},
	};
}

/** Claude saying what the session has cost so far. */
function costing(amount: number): object {
	return {
		kind: "update",
		update: {
			sessionUpdate: "usage_update",
			used: 1,
			size: 10,
			cost: { amount, currency: "USD" },
		},
	};
}

function failed(id: string, command: string, at: string): object {
	return {
		kind: "update",
		at,
		update: {
			sessionUpdate: "tool_call",
			toolCallId: id,
			title: command,
			kind: "execute",
			status: "failed",
			rawInput: { command },
		},
	};
}

/** The agent writing a new file `lines` lines long. */
function wrote(path: string, lines: number, at: string): object {
	return {
		kind: "update",
		at,
		update: {
			sessionUpdate: "tool_call",
			toolCallId: `write-${path}`,
			title: "write",
			kind: "edit",
			status: "completed",
			content: [
				{
					type: "diff",
					path,
					oldText: null,
					newText: Array.from({ length: lines }, () => "x").join("\n"),
				},
			],
		},
	};
}
