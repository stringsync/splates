import { afterEach, beforeEach, expect, it } from "bun:test";
import {
	mkdir,
	mkdtemp,
	realpath,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import decisions from "./decisions.probes";
import { confirmsRoots, fixtureWriteRoots } from "./native-codex-roots";
import type { Probe } from "./probe";

it("grants exactly the seeded task and two private metadata roots", async () => {
	expect(await fixtureWriteRoots(context)).toEqual([
		task,
		join(repository, ".git/splates"),
		join(run, "splates-home"),
	]);
});
it("rejects a task outside this isolated run", async () => {
	context.runtime.decisionPath = outside;
	await expect(fixtureWriteRoots(context)).rejects.toThrow("escape");
});
it("rejects a symlinked metadata directory that escapes the run", async () => {
	await rm(join(repository, ".git/splates"), { recursive: true });
	await symlink(outside, join(repository, ".git/splates"));
	await expect(fixtureWriteRoots(context)).rejects.toThrow("escape");
});
it("rejects a symlinked task that escapes the run", async () => {
	await rm(task, { recursive: true });
	await symlink(outside, task);
	await expect(fixtureWriteRoots(context)).rejects.toThrow("escape");
});
it("rejects a worktree linked to another repository", async () => {
	await writeFile(join(task, ".git"), `gitdir: ${outside}\n`);
	await expect(fixtureWriteRoots(context)).rejects.toThrow(
		"different repository",
	);
});
it("rejects an unrelated probe instead of expanding its permissions", async () => {
	context.probe = {
		...context.probe,
		seed: { id: "other", version: "1", data: null },
	};
	await expect(fixtureWriteRoots(context)).rejects.toThrow("decisions/task@1");
});
it("requires every extra root and rejects ancestors or malformed responses", async () => {
	const roots = await fixtureWriteRoots(context);
	expect(confirmsRoots(roots, repository, roots)).toBe(true);
	expect(confirmsRoots([repository, ...roots], repository, roots)).toBe(true);
	expect(confirmsRoots(roots.slice(1), repository, roots)).toBe(false);
	expect(confirmsRoots([run, ...roots], repository, roots)).toBe(false);
	expect(confirmsRoots(null, repository, roots)).toBe(false);
});

let directory: string;
let run: string;
let repository: string;
let task: string;
let outside: string;
let context: Parameters<typeof fixtureWriteRoots>[0];
beforeEach(async () => {
	directory = await realpath(await mkdtemp(join(tmpdir(), "codex-roots-")));
	run = join(directory, "run");
	repository = join(run, "repo");
	task = join(run, "repo-splates.noindex/decision");
	outside = join(directory, "outside");
	await Promise.all(
		[
			task,
			outside,
			join(repository, ".git/splates"),
			join(repository, ".git/worktrees/decision"),
			join(run, "splates-home"),
		].map((path) => mkdir(path, { recursive: true })),
	);
	await writeFile(
		join(task, ".git"),
		`gitdir: ${join(repository, ".git/worktrees/decision")}\n`,
	);
	context = {
		probe: decisions.probes[0] as Probe,
		runtime: { decisionPath: task },
		isolation: {
			repository,
			splatesHome: join(run, "splates-home"),
			logs: join(run, "logs"),
			outputs: join(run, "outputs"),
			ports: [],
		},
	};
});
afterEach(async () => {
	await rm(directory, { recursive: true, force: true });
});
