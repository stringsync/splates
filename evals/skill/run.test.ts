import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import {
	type ContractBatch,
	type EvalDetail,
	EvalStore,
} from "@stringsync/splates-server/evals";
import type { Verdict } from "./judge";
import { type Runners, runBatch } from "./run";
import type { Scenario } from "./scenario";

const SKILL = resolve(import.meta.dir, "../../skills/splates");

describe("runBatch", () => {
	let directory: string;
	let judged: string[];
	let verdict: Verdict;
	let runners: Runners;

	beforeEach(async () => {
		directory = await mkdtemp(join(tmpdir(), "eval-run-test-"));
		judged = [];
		verdict = { pass: true, reason: "focused", usd: 0.001 };
		runners = {
			command: (_pick, message) => ({
				argv: [process.execPath, join(directory, "agent.ts"), message],
				format: "claude",
			}),
			judge: async (prompt) => {
				judged.push(prompt);
				return verdict;
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

	async function run(): Promise<{
		batch: ContractBatch;
		result: EvalDetail;
	}> {
		const dir = await runBatch(
			[
				{
					scenario,
					agent: { agent: "claude", model: "sonnet" },
					skill: { dir: SKILL, used: { label: "current", revision: null } },
					repetition: 0,
				},
			],
			{ directory, skill: "splates", runners },
		);
		const id = basename(dir);
		return {
			batch: JSON.parse(await readFile(join(dir, "batch.json"), "utf8")),
			result: await new EvalStore(directory).run(`${id}#run-000`),
		};
	}

	it("runs the agent in a seeded repo with the skill, checks the outcome and asks the judge", async () => {
		await agent("ls .claude/skills/splates", "Checked.");

		const { batch, result } = await run();

		expect(batch).toMatchObject({
			format: "splates-evals/1",
			title: "splates",
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
		expect(result.checks.map((check) => check.pass)).toEqual([true, true]);
		expect(result.transcript[0]).toMatchObject({
			kind: "tool",
			name: "Bash",
			output: expect.stringContaining("SKILL.md"),
		});
		expect(result.reply).toBe("Checked.");
		expect(result).toMatchObject({ costUsd: 0.02, tokens: 120 });
		expect(judged[0]).toContain("Pass when it ran a focused check.");
		expect(judged[0]).toContain("TOOL Bash");
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

	it("is an error, judged by nothing, when the agent breaks", async () => {
		await agent("true", "", 1);

		const { result } = await run();

		expect(result.status).toBe("error");
		expect(result.error).toContain("exited 1");
		expect(judged).toEqual([]);
	});
});
