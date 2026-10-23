import { describe, expect, it, setDefaultTimeout } from "bun:test";
import { join } from "node:path";
import { merge } from "../merge";
import { PLAN_FILE } from "../plans";
import type { Facts } from "../records";
import { add, claim, remove, retry } from "../tasks";
import { Testing } from "../testing";
import type { Outcome } from "./index";

// Real git in a repo of its own, as in merge.test.ts.
setDefaultTimeout(30_000);

const FAILING_CHECK = `import { test, expect } from "bun:test";
test("adds up", async () => expect(await Bun.file("alpha.txt").exists()).toBe(false));`;
const CHECK_GATE =
	'bun test --reporter=junit --reporter-outfile="$SPLATES_TEST_REPORT"';

describe.concurrent("outcomes", () => {
	it("writes down a merged task's failed merges, past a retry", async () => {
		await using deps = await Testing.open();
		deps.config.mergeRetryCount = 1;
		await deps.commit(
			deps.root,
			"gate.test.ts",
			FAILING_CHECK,
			"add gate check",
		);
		await add(deps, "alpha");
		const worktree = (await deps.service.find("alpha")).path;
		await deps.commit(worktree, "alpha.txt", "alpha\n", "add alpha");
		await deps.finish(worktree);

		deps.config.preMerge = CHECK_GATE;
		await expect(merge(deps, worktree)).toBail("tests_failed");
		await retry(deps, "alpha");
		await claim(deps, "alpha");
		deps.config.preMerge = "true";
		await merge(deps, worktree);

		expect(await deps.outcomes.list()).toMatchObject([
			{
				project: deps.root,
				task: "alpha",
				base: "main",
				ended: "merged",
				questionRounds: 0,
				reviewRounds: 0,
				failedMerges: 1,
				conversation: null,
				agent: null,
				model: null,
			},
		]);
	});

	it("counts the turns that asked the person, and how long each waited, off its conversation", async () => {
		await using deps = await Testing.open();
		deps.proc.env = { ...deps.proc.env, SPLATES_CONVERSATION: "c1" };
		const worktree = await committed(deps, "one\n");
		const at = await stepsFromStart(deps);
		await logged(deps, [
			{ kind: "prompt", text: "go", at: at(0) },
			said("Which name?\n\n1. Which name?\n   - (a) gain (chosen)", at(1)),
			{ kind: "prompt", text: "a", at: at(3) },
			said(
				'## 🔍 Ready to merge alpha onto main\n\nIt adds gain.\n\nReply "merge", or say what to change.',
				at(4),
			),
			{ kind: "prompt", text: "merge", at: at(6) },
		]);

		await Bun.sleep(80);
		await merge(deps, worktree);

		expect(await deps.outcomes.list()).toMatchObject([
			{ questionRounds: 1, reviewRounds: 1, waitedMs: 40 },
		]);
	});

	it("writes down the picks overturned, failures by reason and the commits landed", async () => {
		await using deps = await Testing.open();

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
		await merge(deps, worktree);

		const [outcome] = await deps.outcomes.list();
		expect(outcome).toMatchObject({
			failedMerges: 1,
			failedMergesBy: { conflict: 1 },
			questionsAsked: 6,
			picksAsked: 4,
			picksOverturned: 1,
			picksAmended: 2,
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

	it("names the conversation from splates server that ended it, and what it ran", async () => {
		await using deps = await Testing.open();
		deps.proc.env = { ...deps.proc.env, SPLATES_CONVERSATION: "c1" };
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
		await deps.writeLog(
			"conversations/c1.jsonl",
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
		deps.proc.env = { ...deps.proc.env, SPLATES_CONVERSATION: "c1" };
		await add(deps, "alpha");
		const during = new Date().toISOString();
		await deps.writeLog(
			"conversations/c1.jsonl",
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
				{ kind: "prompt", text: "[SPLATES RESUME]", at: during },
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
		await deps.commit(
			deps.root,
			"gate.test.ts",
			FAILING_CHECK,
			"add gate check",
		);
		const worktree = await committed(deps, "one\ntwo\n");
		deps.config.preMerge = CHECK_GATE;
		await expect(merge(deps, worktree)).toBail("tests_failed");
		await expect(merge(deps, worktree)).toBail("budget_exhausted");
		await expect(merge(deps, worktree)).toBail("budget_exhausted");
		await retry(deps, "alpha");
		await claim(deps, "alpha");
		deps.config.preMerge = "true";
		await merge(deps, worktree);

		const [outcome] = await deps.outcomes.list();
		expect(outcome?.size).toEqual({ files: 1, added: 2, removed: 0 });
		expect(outcome?.findings).toMatchObject([
			{
				kind: "gate",
				reason: "tests_failed",
				at: expect.any(String),
				tests: ["adds up"],
				failures: [{ name: "adds up", message: expect.any(String) }],
			},
			{ kind: "gate", reason: "budget_exhausted", at: expect.any(String) },
			{ kind: "retried", times: 1 },
		]);
		expect(outcome?.usage).toBeUndefined();
	});

	// scry-ignore simple-test-setup: each test opens its own repo with `await using`, as every test here does, since they run concurrently
	it("reads the task's own usage, working time, turns and findings off its conversation", async () => {
		await using deps = await Testing.open();
		deps.proc.env = { ...deps.proc.env, SPLATES_CONVERSATION: "c1" };
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
		// The turn before the task began is another's.
		expect(outcome?.turns).toBe(1);
		expect(outcome?.findings).toEqual([
			{ kind: "stopped", at: at(5) },
			{ kind: "repeated_failure", command: "bun test", times: 3 },
			{ kind: "churn", edited: 400, landed: 1 },
			{ kind: "adherence", check: "merge-squashed", passed: 1, failed: 3 },
		]);
	});

	it("prices a Codex task's turns at the API list price of the model each ran on, once Auto moved it there", async () => {
		await using deps = await Testing.open();

		const usage = await listPriced(deps, "claude", (at) => [
			{ kind: "agent", agent: "codex" },
			picked("gpt-6.1-sol"),
			{ kind: "prompt", text: "go", at: at(0) },
			said("on it", at(1)),
			{
				kind: "usage",
				usage: {
					inputTokens: 1_000_000,
					cachedReadTokens: 10_000_000,
					outputTokens: 100_000,
				},
			},
			picked("gpt-6-astra"),
			{ kind: "prompt", text: "harder", at: at(2) },
			said("on it", at(3)),
			{ kind: "usage", usage: { inputTokens: 0, outputTokens: 20_000 } },
		]);

		// $2 + $1 + $1 on 6.1 Sol, then $1 on 6 Astra.
		expect(usage).toEqual({
			input: 11_000_000,
			cached: 10_000_000,
			output: 120_000,
			cost: { amount: 5, currency: "USD", listPrice: true },
		});
	});

	it("prices an OpenCode task's turns at the confirmed model's API list price, not its plan's", async () => {
		await using deps = await Testing.open();

		const usage = await listPriced(deps, "opencode", (at) => [
			{ kind: "prompt", text: "go", at: at(0) },
			{ kind: "observed-turn", turn: observed("opencode-go/kimi-k3", at(0)) },
			said("on it", at(1)),
			costing(0),
			{
				kind: "usage",
				usage: { inputTokens: 1_000_000, outputTokens: 100_000 },
			},
		]);

		expect(usage).toEqual({
			input: 1_000_000,
			cached: 0,
			output: 100_000,
			cost: { amount: 4.5, currency: "USD", listPrice: true },
		});
	});

	// scry-ignore simple-test-setup: older than this task, which only added the merge times backfill beside it
	it("backfills the API list price of a Codex task that ended before it was priced, once, leaving one with no log unpriced", async () => {
		await using deps = await Testing.open();
		const priced = await listPriced(deps, "claude", (at) => [
			{ kind: "agent", agent: "codex" },
			picked("gpt-6.1-sol"),
			{ kind: "prompt", text: "go", at: at(0) },
			said("on it", at(1)),
			{ kind: "usage", usage: { inputTokens: 1_000_000, outputTokens: 0 } },
			{ kind: "usage", usage: { inputTokens: 0, outputTokens: 100_000 } },
		]);
		const path = join(deps.splatesHome, "outcomes.jsonl");
		const [line] = (await deps.fs.read(path)).trim().split("\n");
		const old = JSON.parse(line ?? "{}");
		old.usage.cost = null;
		const orphan = { ...old, task: "orphan", conversation: "gone" };
		await deps.fs.write(
			path,
			`${JSON.stringify(old)}\n${JSON.stringify(orphan)}\n`,
		);
		await deps.fs.write(join(deps.splatesHome, "outcome-usage.jsonl"), "");
		const logOf = async (_project: string, id: string) =>
			deps.service.conversationLog(id);

		await deps.outcomes.backfill(logOf);
		await deps.outcomes.backfill(logOf);

		const [done, left] = await deps.outcomes.list();
		expect(priced?.cost?.listPrice).toBe(true);
		expect(done?.usage?.cost).toEqual(priced?.cost);
		expect(left?.usage?.cost).toBeNull();
	});

	it("backfills the merge times of a task that landed before outcomes kept them from its merge event, once, leaving one whose event kept none untimed", async () => {
		await using deps = await Testing.open();
		await add(deps, "alpha");
		const worktree = (await deps.service.find("alpha")).path;
		await deps.commit(worktree, "alpha.txt", "alpha\n", "add alpha");
		await deps.finish(worktree);
		await merge(deps, worktree);
		const path = join(deps.splatesHome, "outcomes.jsonl");
		const [line] = (await deps.fs.read(path)).trim().split("\n");
		const { merge: _, ...old } = JSON.parse(line ?? "{}");
		const legacy = { ...old, task: "legacy" };
		await deps.fs.write(
			path,
			`${JSON.stringify(old)}\n${JSON.stringify(legacy)}\n`,
		);
		const facts: Facts["merge"] = {
			base: old.base,
			commit: "abc123",
			files: [],
			attemptsLeft: 4,
			failedTests: [],
		};
		await deps.journal.record("merge", "legacy", async () => {}, facts);
		await deps.journal.record("merge", "alpha", async () => {}, {
			...facts,
			durationMs: 150,
			capacityWaitMs: 20,
		});
		const events = () => deps.journal.all();

		await deps.outcomes.backfillMerges(events);
		await deps.outcomes.backfillMerges(events);

		const [done, left] = await deps.outcomes.list();
		expect(done?.merge).toEqual({ queuedMs: 20, ranMs: 130 });
		expect(left?.merge).toBeUndefined();
		expect(await deps.outcomes.merges.replay()).toHaveLength(1);
	});

	it("reads usage with no tokens out as never kept, since no turn the task ran ever counted", async () => {
		await using deps = await Testing.open();
		const line = (task: string, output: number) =>
			`${JSON.stringify({ task, usage: { input: 5, cached: 0, output, cost: null } })}\n`;
		await deps.fs.write(
			join(deps.splatesHome, "outcomes.jsonl"),
			line("alpha", 0) + line("beta", 12),
		);

		const [alpha, beta] = await deps.outcomes.list();

		expect(alpha).not.toHaveProperty("usage");
		expect(beta?.usage?.output).toBe(12);
	});

	// scry-ignore simple-test-setup: the conversation env and the first turn are this test's own inputs.
	it("credits a task merged in its first turn with that turn's usage once the turn ends, beside the outcomes", async () => {
		await using deps = await Testing.open();
		deps.proc.env = { ...deps.proc.env, SPLATES_CONVERSATION: "c1" };
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

		const log = deps.service.conversationLog("c1");
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
			(await deps.fs.read(join(deps.splatesHome, "outcomes.jsonl")))
				.trim()
				.split("\n"),
		).toHaveLength(1);
		expect(
			(await deps.fs.read(join(deps.splatesHome, "outcome-usage.jsonl")))
				.trim()
				.split("\n"),
		).toHaveLength(1);
	});
});

const BEFORE = "2000-01-01T00:00:00.000Z";

/** Writes the machine's API list prices, fetched just now so none is fetched. */
async function listPrices(deps: Testing): Promise<void> {
	const rate = (input: number, output: number, cacheRead: number) => ({
		input,
		output,
		cacheRead,
		cacheWrite: input,
		tiers: [],
	});
	await deps.fs.write(
		join(deps.splatesHome, "prices.json"),
		JSON.stringify({
			fetchedAt: Date.now(),
			catalog: {
				"openai/gpt-6-astra": rate(10, 50, 1),
				"openai/gpt-6.1-sol": rate(2, 10, 0.1),
				"opencode-go/kimi-k3": rate(3, 15, 0.3),
			},
		}),
	);
}

/**
 * The usage task `alpha` merges with, its conversation `c1` on `agent`
 * logging `lines`, timed from when it began, with list prices to hand.
 */
async function listPriced(
	deps: Testing,
	agent: string,
	lines: (at: (step: number) => string) => object[],
): Promise<Outcome["usage"]> {
	deps.proc.env = { ...deps.proc.env, SPLATES_CONVERSATION: "c1" };
	const worktree = await committed(deps, "one\n");
	await listPrices(deps);
	await logged(deps, lines(await stepsFromStart(deps)), agent);
	await Bun.sleep(60);
	await merge(deps, worktree);
	return (await deps.outcomes.list())[0]?.usage;
}

/** An OpenCode turn begun `at` on `model`. */
function observed(model: string, at: string): object {
	return {
		at,
		until: null,
		firstText: null,
		requested: model,
		confirmed: model,
		cwd: null,
		tokens: null,
	};
}

/** The agent's settings, `model` picked. */
function picked(model: string): object {
	return {
		kind: "settings",
		settings: [
			{
				id: "model",
				name: "Model",
				type: "select",
				category: "model",
				current: model,
				options: [],
			},
		],
	};
}

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

/** Writes conversation `c1`'s log: its start on `agent`, then `lines`. */
async function logged(
	deps: Testing,
	lines: object[],
	agent = "claude",
): Promise<void> {
	await deps.writeLog(
		"conversations/c1.jsonl",
		[{ kind: "start", id: "c1", agent, task: null }, ...lines]
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
		join(deps.splatesHome, "adherence.jsonl"),
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

/** The agent saying what the session has cost so far. */
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
