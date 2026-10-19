import { readFileSync } from "node:fs";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { encodeTask } from "@stringsync/splates-server/board";
import { FORMAT } from "@stringsync/splates-server/records";
import type { Json } from "./probe";
import { command, seedFile, seedRepository, taskRecord } from "./probe-sandbox";
import { openQuestions } from "./reading";
import { hash, type RunContext, type Seed } from "./runner";

export const lifecycleGoal = "Change value to two";
const plan =
	"# sample\n\n## Goal\n\nChange value to two.\n\n## Next\n\n- [x] Changed value and verified it.\n\n## Notes\n\n## Blocked\n";

export const lifecycleSeed: Seed = {
	id: "lifecycle/local",
	version: "1",
	// File bytes include every local helper; the shared seed helper is fingerprinted too.
	get fingerprint() {
		return hash([
			readFileSync(import.meta.path, "utf8"),
			readFileSync(join(import.meta.dir, "probe-sandbox.ts"), "utf8"),
		]);
	},
	async prepare(context, data) {
		if (
			!data ||
			typeof data !== "object" ||
			Array.isArray(data) ||
			typeof data.situation !== "string"
		) {
			throw new Error("Lifecycle seed requires situation");
		}
		const situation = data.situation;
		await seedRepository(context);
		await seedFile(context, ".git/splates/format", `${FORMAT}\n`);
		const root = context.isolation.repository;
		const trees = join(context.isolation.outputs, "trees");
		await seedFile(
			context,
			"splates.config.ts",
			`export default ${JSON.stringify({ worktreeRoot: trees, mergeRetryCount: 3, preMerge: "bun check.ts" })};\n`,
		);
		await seedFile(context, "value.txt", "one\n");
		await seedFile(
			context,
			"check.ts",
			'if ((await Bun.file("value.txt").text()) !== "two\\n") process.exit(1);\n',
		);
		await checked(context, ["git", "add", "."]);
		await checked(context, ["git", "commit", "-qm", "Seed lifecycle check"]);
		const base = await checked(context, ["git", "rev-parse", "HEAD"]);
		await writeFile(join(context.isolation.outputs, "base"), base);
		if (situation === "fresh") {
			return;
		}
		if (situation === "queued") {
			await checked(context, [
				"splates",
				"task",
				"add",
				"Change value to two",
				"Change value.txt from one to two.",
				"--agent",
				"fake",
			]);
			return;
		}
		await checked(context, [
			"splates",
			"add",
			"sample",
			"--goal",
			lifecycleGoal,
		]);
		const tree = join(trees, "sample");
		await writeFile(
			join(tree, "SPLATES.md"),
			situation === "task"
				? plan
						.replace("- [x] Changed value and verified it.", "")
						.replace(
							"## Next\n",
							"## Next\n\n- [ ] Change value and verify it.\n",
						)
				: plan,
		);
		await writeFile(
			join(context.isolation.outputs, "bin", "lifecycle-splates"),
			`#!/bin/sh\ncd '${tree.replaceAll("'", "'\\''")}' || exit 1\nexec splates "$@"\n`,
			{ mode: 0o755 },
		);
		if (situation === "task") {
			return;
		}
		await writeFile(
			join(tree, "value.txt"),
			situation === "failed-check" ? "wrong\n" : "two\n",
		);
		await checked(context, ["git", "-C", tree, "add", "value.txt"]);
		await checked(context, [
			"git",
			"-C",
			tree,
			"commit",
			"-qm",
			"Change value to two",
		]);
		if (situation === "conflict") {
			await seedFile(context, "value.txt", "base changed\n");
			await checked(context, ["git", "add", "value.txt"]);
			await checked(context, [
				"git",
				"commit",
				"-qm",
				"Independent base change",
			]);
		}
		if (situation === "budget") {
			const found = await taskRecord(root, "sample");
			if (found === null) {
				throw new Error("no record of sample");
			}
			await writeFile(
				found.path,
				encodeTask({ ...found.record, mergeAttempts: 3 }),
			);
		}
		// Agent recovery starts AFTER the real failed CLI response, not after a fabricated transcript.
		if (
			context.probe.execution.kind === "agent" &&
			["conflict", "failed-check", "budget"].includes(situation)
		) {
			const result = await command(context, ["lifecycle-splates", "merge"]);
			if (result.exitCode === 0) {
				throw new Error("Expected seeded merge refusal");
			}
			await writeFile(
				join(tree, "last-merge.txt"),
				`${result.stdout}\n${result.stderr}`,
			);
		}
	},
	async observe(context) {
		const root = context.isolation.repository;
		const task = (await taskRecord(root, "sample"))?.record ?? null;
		const exists = await Bun.file(
			join(context.isolation.outputs, "trees/sample/.git"),
		).exists();
		const base = await readFile(
			join(context.isolation.outputs, "base"),
			"utf8",
		);
		const log = await checked(context, [
			"git",
			"log",
			"--format=%B",
			`${base}..main`,
		]);
		const outcomesFile = Bun.file(
			join(context.isolation.splatesHome, "outcomes.jsonl"),
		);
		const outcomes = (await outcomesFile.exists())
			? (await outcomesFile.text())
					.trim()
					.split("\n")
					.filter(Boolean)
					.map((line) => JSON.parse(line))
			: [];
		const canonicalRoot = await realpath(root);
		const outcome = outcomes.findLast(
			(item) =>
				item.task === "sample" &&
				(item.project === root || item.project === canonicalRoot),
		);
		const result: Record<string, Json> = {
			"task/base": task?.base ?? (task ? "main" : null),
			"task/status": task?.status ?? outcome?.ended ?? null,
			"task/exists": exists,
			"task/asking":
				exists &&
				openQuestions(
					await readFile(
						join(context.isolation.outputs, "trees/sample/SPLATES.md"),
						"utf8",
					).catch(() => ""),
				).length > 0,
			"task/record": task !== null,
			"task/branch":
				(await checked(context, ["git", "branch", "--list", "task/sample"])) !==
				"",
			"main/value": await readFile(join(root, "value.txt"), "utf8"),
			"main/commits": Number(
				await checked(context, ["git", "rev-list", "--count", `${base}..main`]),
			),
			"main/attributed": /co-authored-by:|generated (with|by)|🤖/i.test(log),
		};
		const cli = context.evidence.events.findLast(
			(event) => event.actor === "cli" && event.name === "lifecycle-splates",
		);
		if (cli) {
			result["cli/exit"] = cli.exitCode ?? null;
			const output = cli.payload as { stdout: string; stderr: string };
			const guidance: Record<string, string> = {
				"lifecycle/cli-conflict":
					"`git rebase --continue`, then run `splates merge` again.",
				"lifecycle/cli-tests_failed":
					"main is untouched and task/sample is back at",
				"lifecycle/cli-budget_exhausted":
					"ask the user, who can grant another 3 with `splates retry sample`",
			};
			const expectedGuidance = guidance[context.probe.id];
			if (expectedGuidance) {
				result["cli/guidance"] = output.stderr.includes(expectedGuidance);
			}
			try {
				result["cli/reason"] = JSON.parse(output.stdout).reason ?? null;
			} catch {
				result["cli/reason"] = null;
			}
		}
		if (context.probe.id === "lifecycle/requested-task") {
			const shown = await checked(context, ["splates", "task", "show", "1"]);
			result["task/takenBy"] = /taken by:\s+sample(?:\s|$)/.test(shown)
				? "sample"
				: null;
		}
		return result;
	},
};

async function checked(context: RunContext, argv: string[]): Promise<string> {
	const result = await command(context, argv);
	if (result.exitCode !== 0) {
		throw new Error(
			`Lifecycle fixture ${JSON.stringify(argv)}: ${result.stderr}`,
		);
	}
	return result.stdout.trim();
}
