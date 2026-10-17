import { afterEach, beforeEach, expect, it } from "bun:test";
import {
	chmod,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import continuity from "./continuity.probes";
import decisions from "./decisions.probes";
import { type NativeDriver, nativeAdapter } from "./native-adapter";
import { claudeDriver } from "./native-claude";
import { nativeCodex } from "./native-codex";
import { opencodeDriver } from "./native-opencode";
import { nativeTarget } from "./native-target";
import type { Probe } from "./probe";
import { launchIsolated } from "./probe-adapters";
import { declared } from "./probe-budget-policy";
import { EvalBudgets } from "./probe-budget-store";
import { comparisonKey, probeReport } from "./probe-report";
import { runProbes, type StoredRun } from "./runner";

let directory: string;
let source: string;
const allowance = { tokens: 100, microUsd: 5000 };
beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), "native-integration-"));
	source = join(directory, "skill");
	await mkdir(source);
	await writeFile(
		join(source, "SKILL.md"),
		"---\nname: arbor\ndescription: free fixture\n---\nScripted transport fixture, not adherence.",
	);
});
afterEach(async () => {
	await rm(directory, { recursive: true, force: true });
});

it.each(["claude:sonnet", "codex:fixture", "opencode:provider/model"])(
	"selects native target %s with explicit models and independent control modes",
	(value) => {
		const target = nativeTarget(value, { source, mode: "explicit", allowance });
		expect(target.selector).toBe(value.split(":")[0]);
		expect(target.model).toBe(value.slice(value.indexOf(":") + 1));
		expect(target.adapter.metering?.limits).toEqual({
			tokens: "monitored",
			costUsd: value.startsWith("codex:") ? "unavailable" : "monitored",
		});
		expect(
			target.adapter.metering?.quote(
				decisions.probes[0] as Probe,
				target.model,
			),
		).toEqual(allowance);
	},
);
it.each(["custom:model", "codex:", "opencode:model"])(
	"refuses invalid native target %s",
	(value) => {
		expect(() =>
			nativeTarget(value, { source, mode: "discovery", allowance }),
		).toThrow();
	},
);

it.each(["claude", "codex", "opencode"] as const)(
	"%s: registered decision state/reply assertions survive real free transports; billing remains outstanding",
	async (provider) => {
		const sharedBudget = new EvalBudgets(
			join(directory, "ledger.json"),
			declared({ tokens: 200, per: "day" }, "fixture"),
		);
		const results: StoredRun[] = [];
		// scry-ignore matchers-over-test-logic: sequential sessions exercise retention across runs before the exhausted-ledger assertion.
		for (const selected of ["local-choice", "answer"]) {
			const driver = await transport(provider, selected);
			const runs = await runProbes(
				{
					...decisions,
					probes: decisions.probes.filter(
						(probe) => probe.id === `decisions/${selected}`,
					),
				},
				[
					{
						adapter: nativeAdapter(driver, { source, mode: "discovery" }),
						selector: provider,
						model:
							provider === "claude"
								? "claude-sonnet-4-6"
								: provider === "opencode"
									? "provider/model"
									: "fixture",
					},
				],
				{
					directory: join(directory, selected),
					parallel: 1,
					reps: 1,
					skillHash: "fixture",
					cliHash: "fixture",
					reproduction: ["free fixture"],
					budget: allowance,
					sharedBudget,
				},
			);
			const result = runs[0] as StoredRun;
			expect(result).toBeDefined();
			expect({
				status: result.result.status,
				detail: result.run.evidence.detail,
			}).toEqual({ status: "uncovered", detail: undefined });
			expect(
				result.result.verdicts
					.filter(
						(verdict) =>
							verdict.id.startsWith("plan/") ||
							verdict.id === "assumption-report",
					)
					.map((verdict) => [verdict.id, verdict.status]),
			).toEqual(
				selected === "local-choice"
					? [
							["plan/assumptions", "pass"],
							["plan/blocked", "pass"],
							["assumption-report", "pass"],
						]
					: [["plan/blocked", "pass"]],
			);
			expect(
				result.result.verdicts.find(
					(verdict) => verdict.id === "no-canonical-merge",
				)?.status,
			).toBe("uncovered");
			expect(
				result.run.evidence.events.filter((event) => event.actor === "agent"),
			).toEqual([]);
			expect(result.adapter.runtime.nativeUsageComplete).toBe(false);
			expect(result.run.reproduction).toContain(
				`${provider}:${result.run.identity.model}`,
			);
			expect(result.run.usage.tokens).toBeGreaterThan(0);
			expect(
				await readFile(join(result.run.isolation.logs, "trace.jsonl"), "utf8"),
			).not.toBe("");
			expect(result.run.usage.costUsd).toEqual(
				provider === "codex" ? null : 0.002,
			);
			results.push(result);
		}
		expect((await sharedBudget.report()).windows[0]).toMatchObject({
			reserved: 200,
			remaining: 0,
			consumed: 0,
		});
		await expect(sharedBudget.reserve([allowance])).rejects.toThrow(
			"exhausted",
		);
		expect(probeReport(results)).toContain(
			"Billing incomplete: shared reservation remains outstanding even on success",
		);
		expect(probeReport(results)).toContain("monitored");
	},
	30000,
);
it.each(["claude", "codex", "opencode"] as const)(
	"%s: narrow arbor/git scope is unsupported before any transport launch",
	async (provider) => {
		const driver = await transport(provider, "local-choice");
		const original = continuity.probes.find(
			(probe) => probe.id === "continuity/checkpoint",
		) as Probe;
		expect(original).toBeDefined();
		const [result] = await runProbes(
			{
				...continuity,
				probes: [original],
			},
			[
				{
					adapter: nativeAdapter(driver, { source, mode: "discovery" }),
					model: provider === "claude" ? "claude-sonnet-4-6" : "provider/model",
				},
			],
			{
				directory: join(directory, "unsupported"),
				parallel: 1,
				reps: 1,
				skillHash: "fixture",
				cliHash: "fixture",
				reproduction: [],
				budget: allowance,
			},
		);
		expect(result?.result.status).toBe("unsupported");
		expect(result?.run.usage.tokens).toBeNull();
		expect(result?.run.evidence.detail).toMatch(
			/narrow|allowlist|shell|capabilit/i,
		);
	},
	15000,
);

it("compares partial native results without treating unavailable Codex USD or tool evidence as complete", async () => {
	const claude = await transport("claude", "local-choice");
	const codex = await transport("codex", "local-choice");
	const results = await runProbes(
		{
			...decisions,
			probes: decisions.probes.filter(
				(probe) => probe.id === "decisions/local-choice",
			),
		},
		[
			{
				selector: "claude",
				adapter: nativeAdapter(claude, { source, mode: "discovery" }),
				model: "claude-sonnet-4-6",
			},
			{
				selector: "codex",
				adapter: nativeAdapter(codex, { source, mode: "discovery" }),
				model: "fixture",
			},
		],
		{
			directory: join(directory, "comparison"),
			parallel: 1,
			reps: 1,
			skillHash: "fixture",
			cliHash: "fixture",
			reproduction: [],
			budget: { tokens: 200, microUsd: 10000 },
		},
	);
	expect(results.map((result) => result.result.status)).toEqual([
		"uncovered",
		"uncovered",
	]);
	expect(comparisonKey(results[0] as StoredRun)).toBe(
		comparisonKey(results[1] as StoredRun),
	);
	const report = probeReport(results);
	expect(report).toContain("native-claude@");
	expect(report).toContain("native-codex@");
	expect(report).toContain("USD unknown");
	expect(report).toContain("no-canonical-merge: uncovered");
}, 30000);

async function transport(
	provider: "claude" | "codex" | "opencode",
	selected: string,
): Promise<NativeDriver> {
	if (provider === "codex") {
		return nativeCodex({
			allowance,
			argv: [
				process.execPath,
				join(import.meta.dir, "fixtures/native-codex/server.ts"),
				"success",
				join(directory, `${selected}.wire`),
				selected,
			],
		});
	}
	if (provider === "claude") {
		const executable = join(directory, `claude-${selected}`);
		const frames = (
			await readFile(
				join(import.meta.dir, "fixtures/native-claude/success.jsonl"),
				"utf8",
			)
		)
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		await writeFile(
			executable,
			`#!${process.execPath}\nimport { decisionTransport } from ${JSON.stringify(join(import.meta.dir, "fixtures/decision-transport.ts"))};
const args = process.argv.slice(2);
if (args[0] === '--help') console.log('--model --tools --allowedTools --permission-mode --permission-prompts --max-budget-usd --output-format --setting-sources --strict-mcp-config --no-session-persistence');
else if(args[0] === 'auth') console.log('{"loggedIn":true}');
else { await Bun.stdin.text(); const frames = ${JSON.stringify(frames)}; frames.at(-1).result = await decisionTransport(process.cwd(), ${JSON.stringify(selected)}); for (const frame of frames) console.log(JSON.stringify(frame)); }
`,
		);
		await chmod(executable, 0o755);
		return claudeDriver({ allowance, executable });
	}
	const driver = opencodeDriver({ allowance });
	driver.create = (request) =>
		opencodeDriver({
			allowance,
			launch: (_argv, cwd, env) =>
				launchIsolated({ ...request.context, cleanup: () => {} })(
					[
						process.execPath,
						join(import.meta.dir, "fixtures/opencode/server.ts"),
					],
					cwd,
					{ ...env, NATIVE_DECISION_FIXTURE: selected },
				),
		}).create(request);
	return driver;
}
