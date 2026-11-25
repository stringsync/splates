import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ContractBatch, ContractDetail, ContractResult } from "./contract";
import { type JudgePick, judgeName, type Verdict } from "./judge";
import { restoreRun } from "./keep";
// vet-ignore test-setup-names-what-it-makes: harnessErrorOf is the exported production function under test.
import { type Cell, harnessErrorOf, type Runners, runBatch } from "./run";
import { sandbox } from "./sandbox";
import type { Scenario } from "./scenario";

const SKILL = resolve(import.meta.dir, "fixtures/demo-skill");

/** What one test changes of the batch `run` starts. */
interface RunOverrides {
	scenario?: Scenario;
	judge?: JudgePick;
}

describe("runBatch", () => {
	let directory: string;
	let judged: string[];
	let judges: string[];
	let verdict: Verdict;
	let runners: Runners;

	beforeEach(async () => {
		directory = await mkdtemp(join(tmpdir(), "eval-run-test-"));
		judged = [];
		judges = [];
		verdict = { pass: true, reason: "focused", usd: 0.001 };
		runners = {
			command: (_pick, message) => ({
				argv: [process.execPath, join(directory, "agent.ts"), message],
				format: "claude",
			}),
			judge: async (prompt, _env, pick) => {
				judged.push(prompt);
				judges.push(judgeName(pick));
				return { ...verdict, judge: judgeName(pick) };
			},
		};
	});

	afterEach(() => rm(directory, { recursive: true, force: true }));

	/** A stand-in Claude that runs `command` in the repo and replies `reply`. */
	async function agent(command: string, reply: string, exit = 0) {
		await writeFile(
			join(directory, "agent.ts"),
			`const out = Bun.spawnSync(["sh", "-c", ${JSON.stringify(command)}]);
const lines = [
	{ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: ${JSON.stringify(command)} } }] } },
	{ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: out.stdout.toString() }] } },
	{ type: "assistant", message: { content: [{ type: "text", text: ${JSON.stringify(reply)} }] } },
	{ type: "result", subtype: "success", is_error: false, result: ${JSON.stringify(reply)}, total_cost_usd: 0.02, num_turns: 2, usage: { input_tokens: 100, output_tokens: 20 } },
];
for (const line of lines) console.log(JSON.stringify(line));
process.exit(${exit});
`,
		);
	}

	const scenario: Scenario = {
		id: "test/focused",
		aspect: "test",
		requirement: "Run only the tests it reaches.",
		async seed(repo) {
			await repo.write("seeded.txt", "seeded\n");
		},
		message: "Check it.",
		checks: [
			{
				id: "seeded",
				about: "the seed is there",
				test: async ({ repo }) =>
					(await repo.run(["cat", "seeded.txt"])) === "seeded\n",
			},
			{
				id: "no-rm",
				about: "never ran rm",
				test: ({ commands }) => !commands.some((each) => each.startsWith("rm")),
			},
		],
		judge: "Pass when it ran a focused check.",
	};

	async function run(opts: RunOverrides = {}): Promise<{
		batch: ContractBatch;
		result: ContractDetail & ContractResult;
	}> {
		const dir = await runBatch(
			[
				{
					scenario: opts.scenario ?? scenario,
					agent: { agent: "claude", model: "sonnet" },
					skill: { dir: SKILL, used: { label: "current", revision: null } },
					repetition: 0,
				},
			],
			{
				directory,
				skill: "demo-skill",
				producer: "demo",
				runners,
				...(opts.judge === undefined ? {} : { judge: opts.judge }),
			},
		);
		return {
			batch: JSON.parse(await readFile(join(dir, "batch.json"), "utf8")),
			result: {
				...JSON.parse(await readFile(join(dir, "results.jsonl"), "utf8")),
				...JSON.parse(await readFile(join(dir, "run-000.json"), "utf8")),
			},
		};
	}

	it("saves timed tool steps and check evidence in the run detail", async () => {
		runners.command = () => ({
			argv: [
				"printf",
				"%s\n",
				JSON.stringify({ type: "text", part: { text: "Checking." } }),
				JSON.stringify({
					type: "tool_use",
					part: {
						tool: "bash",
						state: {
							input: { command: "ls missing" },
							error: "Missing",
							time: { start: 4, end: 14 },
						},
					},
				}),
			],
			format: "opencode",
		});
		const { result } = await run({
			scenario: {
				...scenario,
				checks: [
					{
						id: "path",
						about: "Uses the seeded path",
						test: ({ transcript }) => ({
							pass: false,
							step: {
								index: transcript.findIndex((step) => step.kind === "tool"),
								observed: "The command used a missing path.",
							},
						}),
					},
					{ id: "edit", about: "Makes an edit", test: () => false },
					{
						id: "verify",
						about: "Verifies the edit",
						test: ({ transcript }) => ({
							pass: false,
							step: { index: transcript.length, observed: "No verification." },
						}),
					},
				],
			},
		});

		expect(result.status).toBe("fail");
		expect(result.transcript?.[1]).toMatchObject({
			kind: "tool",
			milliseconds: 10,
		});
		expect(result.checks?.map(({ pass, step }) => ({ pass, step }))).toEqual([
			{
				pass: false,
				step: { index: 1, observed: "The command used a missing path." },
			},
			{ pass: false, step: undefined },
			{ pass: false, step: undefined },
		]);
	});

	it("runs the agent in a seeded repo with the skill, checks the outcome and asks the judge", async () => {
		await agent("ls .claude/skills/demo-skill", "Checked.");

		const { batch, result } = await run();

		expect(batch).toMatchObject({
			format: "splates-evals/1",
			title: "demo-skill",
			producer: "demo",
			revision: {
				skillHash: expect.stringMatching(/^[0-9a-f]{64}$/),
				scenarioHash: expect.stringMatching(/^[0-9a-f]{64}$/),
			},
			cells: [
				{
					id: "run-000",
					case: "test/focused",
					group: "test",
					about: "Run only the tests it reaches.",
					target: { agent: "claude", model: "sonnet" },
				},
			],
		});
		expect(result.status).toBe("pass");
		expect(result.checks?.map((check) => check.pass)).toEqual([true, true]);
		expect(result.transcript?.[0]).toMatchObject({
			kind: "tool",
			name: "Bash",
			output: expect.stringContaining("SKILL.md"),
		});
		expect(result.reply).toBe("Checked.");
		expect(result).toMatchObject({ costUsd: 0.021, tokens: 120 });
		expect(judged[0]).toContain("Pass when it ran a focused check.");
		expect(judged[0]).toContain("TOOL Bash");
		expect(result.phases).toEqual({
			setupMs: expect.any(Number),
			agentMs: expect.any(Number),
			judgeMs: expect.any(Number),
		});
	});

	it("keeps the ended repo so a restored run gives the checks the same verdicts", async () => {
		await agent("echo edited > seeded.txt && echo new > fresh.txt", "Done.");
		const content: Scenario = {
			...scenario,
			checks: [
				{
					id: "edited",
					about: "the agent's uncommitted edits are there",
					test: async ({ repo }) =>
						(await repo.run(["cat", "seeded.txt"])) === "edited\n" &&
						(await repo.run(["cat", "fresh.txt"])) === "new\n" &&
						(await repo.run(["git", "log", "--format=%s"])).includes("Seed"),
				},
				{
					id: "ran-echo",
					about: "the commands are rebuilt",
					test: ({ commands }) =>
						commands.some((each) => each.startsWith("echo")),
				},
			],
		};
		const dir = await runBatch(
			[
				{
					scenario: content,
					agent: { agent: "claude", model: "sonnet" },
					skill: { dir: SKILL, used: { label: "current", revision: null } },
					repetition: 0,
				},
			],
			{ directory, skill: "demo-skill", runners },
		);
		const detail: ContractDetail = JSON.parse(
			await readFile(join(dir, "run-000.json"), "utf8"),
		);
		expect(detail.repo).toEqual({
			bundle: "run-000.bundle",
			diff: "run-000.diff",
		});
		const stored = detail.checks?.map((check) => check.pass);
		expect(stored).toEqual([true, true]);

		const restored = await restoreRun(dir, "run-000");
		try {
			const again = await Promise.all(
				(content.checks ?? []).map((check) => check.test(restored.outcome)),
			);
			expect(again).toEqual(stored as boolean[]);
		} finally {
			await restored.remove();
		}
	});

	it("fails on a check that does not hold, or a judge that says no", async () => {
		await agent("rm -f seeded.txt", "Done.");

		expect((await run()).result.status).toBe("fail");

		await agent("true", "Done.");
		verdict = { pass: false, reason: "ran the whole suite", usd: null };
		const { result } = await run();
		expect(result.status).toBe("fail");
		expect(result.judge?.reason).toBe("ran the whole suite");
	});

	it("judges with the default or the scenario's own, and records who judged", async () => {
		await agent("true", "Done.");

		const plain = await run();
		const own = await run({
			scenario: { ...scenario, judgeWith: "claude:haiku" },
		});

		expect(judges).toEqual(["claude:sonnet", "claude:haiku"]);
		expect(plain.result.judge?.judge).toBe("claude:sonnet");
		expect(own.result.judge?.judge).toBe("claude:haiku");
		expect(own.batch.cells[0]?.fingerprint).not.toBe(
			plain.batch.cells[0]?.fingerprint,
		);
	});

	it.each([false, true])(
		"makes each run's sandbox with the given factory (cell: %s)",
		// vet-ignore simple-test-setup: The factory and its call log are specific to this precedence test.
		async (perCell) => {
			await agent("cat extra.txt", "Done.");
			const made: string[] = [];
			const factory = async (skill: string, each: Scenario) => {
				made.push(each.id);
				const box = await sandbox(skill, each.seed, each.change);
				await box.repo.write("extra.txt", "extra\n");
				return box;
			};
			const dir = await runBatch(
				[
					{
						scenario,
						...(perCell ? { sandbox: factory } : {}),
						agent: { agent: "claude", model: "sonnet" },
						skill: { dir: SKILL, used: { label: "current", revision: null } },
						repetition: 0,
					},
				],
				{
					directory,
					skill: "demo-skill",
					runners,
					sandbox: perCell
						? async () => {
								throw new Error("batch factory must not run");
							}
						: factory,
				},
			);
			const detail: ContractDetail = JSON.parse(
				await readFile(join(dir, "run-000.json"), "utf8"),
			);
			expect(made).toEqual(["test/focused"]);
			expect(detail.transcript?.[0]).toMatchObject({
				output: expect.stringContaining("extra"),
			});
		},
	);

	it("is an error, judged by nothing, when the agent breaks", async () => {
		await agent("true", "", 1);

		const { result } = await run();

		expect(result.status).toBe("error");
		expect(result.reason).toContain("exited 1");
		expect(judged).toEqual([]);
	});

	it("resumes an opencode run that ends without a reply when the scenario asks", async () => {
		const say = (text: string) => [
			"sh",
			"-c",
			`echo '{"type":"text","part":{"text":"${text}"}}'`,
		];
		const dir = await runBatch(
			[
				{
					scenario: { ...scenario, checks: [], followUp: { turns: 2 } },
					agent: { agent: "opencode", model: "m" },
					skill: { dir: SKILL, used: { label: "current", revision: null } },
					repetition: 0,
				},
			],
			{
				directory,
				skill: "demo-skill",
				producer: "demo",
				runners: {
					...runners,
					command: () => ({ argv: say(""), format: "opencode" }),
					continue: () => ({ argv: say("Final."), format: "opencode" }),
				},
			},
		);
		const detail = JSON.parse(
			await readFile(join(dir, "run-000.json"), "utf8"),
		);
		expect(detail.reply).toBe("Final.");
	});

	it("classifies harness errors apart from timeouts and mid-run runtime errors", () => {
		const empty = {
			reply: "",
			transcript: [],
			usd: null,
			tokens: null,
			turns: 0,
			error: null,
		};
		expect(harnessErrorOf(empty, "kimi")).toBe(
			"kimi returned an empty transcript",
		);
		expect(
			harnessErrorOf(
				{ ...empty, error: "codex failed to start:\nENOENT" },
				"codex",
			),
		).toBe("codex failed to start: ENOENT");
		expect(
			harnessErrorOf(
				{
					...empty,
					transcript: [{ kind: "text", text: "hi" }],
					error: "opencode: 401 Unauthorized",
				},
				"opencode",
			),
		).toBe("opencode: 401 Unauthorized");
		expect(
			harnessErrorOf(
				{
					...empty,
					transcript: [{ kind: "text", text: "hi" }],
					error: "claude: model_not_found",
				},
				"claude",
			),
		).toBe("claude: model_not_found");
		expect(
			harnessErrorOf({ ...empty, error: "stopped after 3 minutes" }, "claude"),
		).toBeNull();
		expect(
			harnessErrorOf(
				{
					...empty,
					transcript: [{ kind: "text", text: "partial" }],
					reply: "partial",
					error: "claude ended: error_max_turns",
				},
				"claude",
			),
		).toBeNull();
	});

	it("probes each target once before fanning out, drops broken targets and skips their remaining cells", async () => {
		await agent("true", "Checked.");
		const invoked: string[] = [];
		const skill = { dir: SKILL, used: { label: "current", revision: null } };
		const scenarioTwo: Scenario = { ...scenario, id: "test/second" };
		const cells: Cell[] = [
			{
				scenario,
				agent: { agent: "claude", model: "bad-model" },
				skill,
				repetition: 0,
			},
			{
				scenario: scenarioTwo,
				agent: { agent: "claude", model: "bad-model" },
				skill,
				repetition: 0,
			},
			{
				scenario,
				agent: { agent: "claude", model: "bad-model" },
				skill,
				repetition: 1,
			},
			{
				scenario,
				agent: { agent: "claude", model: "good-model" },
				skill,
				repetition: 0,
			},
			{
				scenario: scenarioTwo,
				agent: { agent: "claude", model: "good-model" },
				skill,
				repetition: 0,
			},
		];
		const landedStatuses: string[] = [];
		const argvByModel: Record<string, (message: string) => string[]> = {
			"bad-model": () => ["sh", "-c", "true"],
			"good-model": (message) => [
				process.execPath,
				join(directory, "agent.ts"),
				message,
			],
		};
		const dir = await runBatch(cells, {
			directory,
			skill: "demo-skill",
			producer: "demo",
			parallel: 4,
			runners: {
				...runners,
				command: (pick, message) => {
					invoked.push(`${pick.model}:${message}`);
					return {
						argv: argvByModel[pick.model ?? "good-model"]?.(message) ?? [],
						format: "claude",
					};
				},
			},
			landed: (result) => landedStatuses.push(result.status),
		});

		expect(invoked.slice(0, 2).sort()).toEqual([
			"bad-model:Check it.",
			"good-model:Check it.",
		]);
		expect(invoked.slice(2)).toEqual(["good-model:Check it."]);
		expect(
			landedStatuses.filter((status) => status === "harness"),
		).toHaveLength(1);
		expect(
			landedStatuses.filter((status) => status === "skipped"),
		).toHaveLength(2);
		expect(landedStatuses.filter((status) => status === "pass")).toHaveLength(
			2,
		);

		const lines = (await readFile(join(dir, "results.jsonl"), "utf8"))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as ContractResult);
		const byCell = new Map(lines.map((line) => [line.cell, line]));

		expect(byCell.get("run-000")).toMatchObject({
			status: "error",
			// vet-ignore test-setup-names-what-it-makes: harness is the ContractResult field name.
			harness: "error",
			reason: "claude returned an empty transcript",
		});
		expect(byCell.get("run-001")).toMatchObject({
			status: "error",
			// vet-ignore test-setup-names-what-it-makes: harness is the ContractResult field name.
			harness: "skipped",
			reason: "skipped: claude returned an empty transcript",
			milliseconds: 0,
		});
		expect(byCell.get("run-002")).toMatchObject({
			status: "error",
			// vet-ignore test-setup-names-what-it-makes: harness is the ContractResult field name.
			harness: "skipped",
			reason: "skipped: claude returned an empty transcript",
			milliseconds: 0,
		});
		expect(byCell.get("run-003")).toMatchObject({ status: "pass" });
		expect(byCell.get("run-003")?.harness).toBeUndefined();
		expect(byCell.get("run-004")).toMatchObject({ status: "pass" });
	});
});
