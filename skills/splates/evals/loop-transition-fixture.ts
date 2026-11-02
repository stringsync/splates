import { join, relative } from "node:path";
import type { LoopBatch, LoopResult } from "@evals/evals/loop";
import type { Repo } from "@evals/evals/scenario";
import { savedLoop } from "./loop-fixture";

export const task = "loop-change";
export const subject = "skills/splates/SKILL.md";
export const baselineText =
	"# Landing\n\nCommit the completed change and report the outcome.\n";
export const candidateText =
	"# Landing\n\nCommit the completed change, then use splates merge --message with what the base gains. Report the merged task.\n";
export const transitions = [
	["request", 1, "baseline-running"],
	["baseline", 2, "baseline-diagnosing"],
	["diagnose", 3, "editing"],
	["propose", 4, "awaiting-comparison"],
	["comparison-request", 5, "comparing"],
	["comparison", 6, "deciding"],
	["keep", 7, "baseline-diagnosing"],
	["revert", 7, "baseline-diagnosing"],
	["rebaseline", 8, "baseline-awaiting-run"],
	["stop", 4, "stopped"],
	["complete", 7, "complete"],
] as const;
export type Transition = (typeof transitions)[number][0];

/** Build a persisted lifecycle snapshot and its matching code task in a sandbox. */
export class TransitionFixture {
	constructor(private readonly repo: Repo) {}

	/** Seed the code under improvement separately from the installed skill being graded. */
	async seed(): Promise<void> {
		const repo = this.repo;
		await repo.write(subject, baselineText);
		await repo.write(".gitignore", "results/\n");
		await repo.write(
			"skills/splates/evals/landing.ts",
			'export const checks = ["merged"];\n',
		);
	}

	/** Persist one real lifecycle prefix and leave its linked task at the matching revision. */
	async transition(transition: Transition): Promise<void> {
		const repo = this.repo;
		await repo.run([
			"splates",
			"add",
			task,
			"--goal",
			"Improve landing/merge-message by clarifying the landing guidance in skills/splates/SKILL.md",
		]);
		const worktree = (await repo.run(["splates", "path", task])).trim();
		await repo.write(
			relative(repo.dir, join(worktree, "SPLATES.md")),
			`# ${task}\n\n## Goal\n\nImprove landing/merge-message in skills/splates/SKILL.md, following durable loop recovery.\n\n## Verification\n\nThe loop record and results directory in the main repository hold the paid evidence.\n`,
		);
		let saved = await savedLoop(repo);
		const baseline: LoopBatch = {
			id: "original-batch",
			contract: saved.loop.contract,
			revision: saved.loop.revision,
		};
		await this.evidence(baseline, ["fail", "fail", "fail"]);
		await this.advance("request", { batch: baseline });
		if (transition === "request") {
			return;
		}
		await this.advance("record", {
			completion: { batch: baseline, results: ["fail", "fail", "fail"] },
		});
		if (transition === "baseline") {
			return;
		}
		await this.advance("diagnose", {
			diagnosis: "skill",
			hypothesis:
				"The landing guidance stops at committing; explicitly require splates merge and its outcome report.",
		});
		if (transition === "diagnose") {
			return;
		}
		if (transition === "stop") {
			await this.advance("stop", {
				reason: "The person stopped the experiment before editing.",
			});
			return;
		}
		await repo.write(
			relative(repo.dir, join(worktree, subject)),
			candidateText,
		);
		await repo.run(["git", "-C", worktree, "add", subject]);
		await repo.run([
			"git",
			"-C",
			worktree,
			"commit",
			"-qm",
			"Clarify landing through splates merge",
		]);
		const candidate = (
			await repo.run(["git", "-C", worktree, "rev-parse", "HEAD"])
		).trim();
		await this.advance("propose", {
			revision: candidate,
			contract: baseline.contract,
		});
		if (transition === "propose") {
			return;
		}
		const comparison: LoopBatch = {
			id: "comparison-batch",
			contract: baseline.contract,
			revision: candidate,
			baselineBatchId: baseline.id,
		};
		await this.advance("request", { batch: comparison });
		if (transition === "comparison-request") {
			return;
		}
		const results: LoopResult[] =
			transition === "revert" || transition === "rebaseline"
				? ["fail", "fail", "fail"]
				: ["pass", "pass", transition === "complete" ? "pass" : "fail"];
		await this.evidence(comparison, results, baseline.revision);
		await this.advance("record", {
			completion: {
				batch: comparison,
				results,
				baselineResults: ["fail", "fail", "fail"],
			},
		});
		if (transition === "comparison") {
			return;
		}
		if (transition === "revert" || transition === "rebaseline") {
			await repo.run(["git", "-C", worktree, "revert", "--no-edit", candidate]);
			await this.advance("revert", {
				reason:
					"No gain: zero of three candidate passes against zero of three paired baseline passes.",
			});
		} else {
			await this.advance("keep", {
				reason:
					"Candidate gained against the paired baseline; retain its landing instruction.",
			});
		}
		if (transition === "rebaseline") {
			saved = await savedLoop(repo);
			await this.advance("rebaseline", {
				contract: { ...saved.loop.contract, repetitions: 4 },
			});
		}
	}

	/** Finish an in-flight comparison with chosen results, or leave only one repetition on disk. */
	async finish(results: LoopResult[], incomplete = false): Promise<void> {
		const saved = await savedLoop(this.repo);
		if (saved.loop.stage.kind !== "comparing") {
			throw new Error("Expected comparison");
		}
		const batch = saved.loop.stage.batch;
		await this.evidence(batch, results, saved.loop.revision);
		if (!incomplete) {
			await this.advance("record", {
				completion: {
					batch,
					results,
					baselineResults: ["fail", "fail", "fail"],
				},
			});
		}
	}

	/** Seed the third no-gain decision with two prior code reverts and their retained evidence. */
	async thirdNoGain(): Promise<void> {
		await this.transition("revert");
		const repo = this.repo;
		const worktree = (await repo.run(["splates", "path", task])).trim();
		for (const round of [2, 3]) {
			const saved = await savedLoop(repo);
			await this.advance("diagnose", {
				diagnosis: "skill",
				hypothesis: `Round ${round}: make the landing instruction more explicit.`,
			});
			await repo.write(
				relative(repo.dir, join(worktree, subject)),
				`${candidateText}\nAlways finish the landing step (experiment ${round}).\n`,
			);
			await repo.run(["git", "-C", worktree, "add", subject]);
			await repo.run([
				"git",
				"-C",
				worktree,
				"commit",
				"-qm",
				`Try landing instruction ${round}`,
			]);
			const candidate = (
				await repo.run(["git", "-C", worktree, "rev-parse", "HEAD"])
			).trim();
			await this.advance("propose", {
				revision: candidate,
				contract: saved.loop.contract,
			});
			await this.advance("request", {
				batch: {
					id: `comparison-${round}`,
					contract: saved.loop.contract,
					revision: candidate,
					baselineBatchId: "original-batch",
				},
			});
			await this.finish(["fail", "fail", "fail"]);
			if (round === 2) {
				await repo.run([
					"git",
					"-C",
					worktree,
					"revert",
					"--no-edit",
					candidate,
				]);
				await this.advance("revert", {
					reason: "No gain in the paired comparison.",
				});
			}
		}
	}

	/** Commit a changed suite while retaining the earlier baseline contract. */
	async changedSuite(): Promise<void> {
		await this.transition("baseline");
		const repo = this.repo;
		const worktree = (await repo.run(["splates", "path", task])).trim();
		const file = "skills/splates/evals/landing.ts";
		await repo.write(
			relative(repo.dir, join(worktree, file)),
			'export const checks = ["merged", "reported-task-name"];\n',
		);
		await repo.run(["git", "-C", worktree, "add", file]);
		await repo.run([
			"git",
			"-C",
			worktree,
			"commit",
			"-qm",
			"Require the task name in the landing report",
		]);
	}

	/** Record a fixture transition through the public CLI using its current version. */
	async advance(verb: string, payload: unknown): Promise<void> {
		const repo = this.repo;
		const saved = await savedLoop(repo);
		const file = `.git/loop-event-${saved.version}.json`;
		await repo.write(file, JSON.stringify(payload));
		await repo.run([
			"splates",
			"evals",
			verb,
			"recovery",
			file,
			"--version",
			String(saved.version),
			"--event",
			`seed-${saved.version}`,
			"--task",
			task,
		]);
	}

	/** Write original transcript evidence for each repetition and paired baseline column. */
	async evidence(
		batch: LoopBatch,
		results: LoopResult[],
		baseline?: string,
	): Promise<void> {
		const repo = this.repo;
		const cells = results.flatMap((_, repetition) => [
			{
				id: `run-${repetition}`,
				case: batch.contract.scenario,
				target: batch.contract.target,
				repetition,
			},
			...(baseline
				? [
						{
							id: `base-${repetition}`,
							case: batch.contract.scenario,
							target: { ...batch.contract.target, variant: baseline },
							repetition,
						},
					]
				: []),
		]);
		await repo.write(
			`results/${batch.id}/batch.json`,
			JSON.stringify({
				format: "splates-evals/1",
				startedAt: "2026-01-01T00:00:00Z",
				cells,
			}),
		);
		const lines = [];
		for (const cell of cells) {
			const status = cell.id.startsWith("base-")
				? "fail"
				: results[cell.repetition];
			const passed = status === "pass";
			lines.push(
				JSON.stringify({
					cell: cell.id,
					status,
					detail: `${cell.id}.json`,
					...(status === "error"
						? { reason: "Agent launch failed before producing output" }
						: {}),
				}),
			);
			await repo.write(
				`results/${batch.id}/${cell.id}.json`,
				JSON.stringify({
					input: "Land the completed change.",
					checks: [{ id: "merged", about: "Used splates merge", pass: passed }],
					reply:
						status === "error"
							? ""
							: passed
								? "Merged the completed change."
								: "Done, I committed the change.",
					transcript:
						status === "error"
							? []
							: [
									{
										kind: "tool",
										name: "shell",
										input: passed
											? "splates merge --message 'Finish change'"
											: "git commit -am 'Finish change'",
										output: passed ? "Merged" : "Committed",
									},
								],
				}),
			);
		}
		await repo.write(
			`results/${batch.id}/results.jsonl`,
			`${lines.join("\n")}\n`,
		);
	}
}
