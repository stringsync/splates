import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { checkLabel, copyRun, scrubText } from "./labels";
import type { Runners } from "./run";
import { runBatch } from "./run";
import type { Check, Scenario } from "./scenario";

const SKILL = resolve(import.meta.dir, "fixtures/demo-skill");

describe("labels", () => {
	let directory: string;
	let batch: string;
	let runners: Runners;

	const scenario: Scenario = {
		id: "test/focused",
		aspect: "test",
		requirement: "Edit the file.",
		message: "Edit it.",
		async seed(repo) {
			await repo.write("seeded.txt", "seeded\n");
		},
		checks: [
			{
				id: "edited",
				about: "seeded.txt was edited",
				test: async ({ repo }) =>
					(await repo.run(["cat", "seeded.txt"])) === "edited\n",
			},
			{
				id: "no-rm",
				about: "never ran rm",
				test: ({ commands }) => !commands.some((each) => each.startsWith("rm")),
			},
		],
		judge: "Pass.",
	};

	beforeEach(async () => {
		directory = await mkdtemp(join(tmpdir(), "eval-regrade-test-"));
		const command = "echo edited > seeded.txt";
		await writeFile(
			join(directory, "agent.ts"),
			`Bun.spawnSync(["sh", "-c", ${JSON.stringify(command)}]);
const lines = [
	{ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: ${JSON.stringify(command)} } }] } },
	{ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "" }] } },
	{ type: "result", subtype: "success", is_error: false, result: "Done.", total_cost_usd: 0.02, num_turns: 1, usage: { input_tokens: 1, output_tokens: 1 } },
];
for (const line of lines) console.log(JSON.stringify(line));
`,
		);
		runners = {
			command: () => ({
				argv: [process.execPath, join(directory, "agent.ts")],
				format: "claude",
			}),
			judge: async () => ({ pass: true, reason: "ok", usd: 0 }),
		};
		batch = await runBatch(
			[
				{
					scenario,
					agent: { agent: "claude", model: "sonnet" },
					skill: { dir: SKILL, used: { label: "current", revision: null } },
					repetition: 0,
				},
			],
			{ directory, skill: "demo-skill", runners },
		);
	});

	afterEach(() => rm(directory, { recursive: true, force: true }));

	it("copies a run, and today's graders agree with a true label", async () => {
		const dest = join(directory, "labels", "good");
		await copyRun(batch, "run-000", dest);
		const label = {
			scenario: "test/focused",
			run: "labels/good",
			expect: "pass" as const,
			why: "edited the file",
		};
		expect(
			await checkLabel(label, directory, [{ scenario, dir: SKILL }]),
		).toBeNull();
	});

	it("names the run when a changed check disagrees with its label", async () => {
		const dest = join(directory, "labels", "good");
		await copyRun(batch, "run-000", dest);
		const label = {
			scenario: "test/focused",
			run: "labels/good",
			expect: "pass" as const,
			why: "edited the file",
		};
		const strict: Scenario = {
			...scenario,
			checks: [
				{
					...((scenario.checks as Check[])[0] as Check),
					test: async () => false,
				},
			],
		};
		const why = await checkLabel(label, directory, [
			{ scenario: strict, dir: SKILL },
		]);
		expect(why).toContain("labels/good");
		expect(why).toContain("labelled pass");
		expect(why).toContain("now say fail");
	});

	it("reports a label whose scenario is gone", async () => {
		const label = {
			scenario: "test/gone",
			run: "labels/x",
			expect: "fail" as const,
			why: "w",
		};
		expect(
			await checkLabel(label, directory, [{ scenario, dir: SKILL }]),
		).toContain("no scenario");
	});

	it("scrubs secrets from text", () => {
		const text =
			"key sk-abcdefghijklmnopqrstuv and TOK123456789 and Bearer abcdefghijklmnopqrstu";
		const out = scrubText(text, { MY_API_TOKEN: "TOK123456789" });
		expect(out).not.toContain("sk-abc");
		expect(out).not.toContain("TOK123456789");
		expect(out).not.toContain("abcdefghijklmnopqrstu\n");
		expect(out).toContain("Bearer [redacted]");
	});

	it("leaves ordinary ids ending in sk- alone", () => {
		const text =
			"updated-task-abcdefghijklmnopqrstuv and risk-abcdefghijklmnopqrstuv";
		expect(scrubText(text, {})).toBe(text);
		expect(scrubText("(sk-abcdefghijklmnopqrstuv)", {})).not.toContain(
			"sk-abc",
		);
	});

	it("refuses to copy a run whose kept repo holds a secret", async () => {
		expect(
			copyRun(batch, "run-000", join(directory, "labels", "bad"), {
				env: { MY_API_TOKEN: "seeded.txt" },
			}),
		).rejects.toThrow("looks like a secret");
	});
});
