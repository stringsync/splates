import { afterEach, beforeEach, expect, it } from "bun:test";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { MemoryLogger } from "webappwiz/log";
import { skillChange } from "./probe-change";
import { fastCli } from "./probe-cli";
import { freezeSnapshots, verifySnapshot } from "./probe-snapshots";

it("plans exactly two same-skill cells without creating results or reserving", async () => {
	const log = new MemoryLogger();
	await fastCli([...args, "--directory", join(directory, "results")], log);
	const output = log.entries.map((entry) => entry.message).join("\n");
	expect(output).toContain(
		"Unchanged baseline (no candidate comparison): 2 cells",
	);
	expect(output).toContain('"tokens":2000000,"microUsd":4000000');
	expect(output).toContain(
		"no native startup, authentication, reservation or model execution",
	);
	expect(await readdir(directory)).not.toContain("results");
});

it("plans one Claude baseline without requiring a Codex target", async () => {
	const log = new MemoryLogger();
	await fastCli(claudeOnly, log);
	const output = log.entries.map((entry) => entry.message).join("\n");
	expect(output).toContain(
		"Unchanged baseline (no candidate comparison): 1 cells",
	);
	expect(output).toContain('"tokens":1000000,"microUsd":2000000');
});

it("keeps the ordinary unchanged gate and genuine-diff paired policy intact", async () => {
	const log = new MemoryLogger();
	await fastCli(
		args.filter((arg) => arg !== "--unchanged-baseline"),
		log,
	);
	expect(log.entries.map((entry) => entry.message).join("\n")).toContain(
		"Skipped model execution",
	);
	await expect(
		freezeSnapshots(await skillChange(skill, "HEAD"), directory),
	).rejects.toThrow("genuine instruction diff");
});

it.each(
	[
		["--paired"],
		["--failed"],
		["--module", "not-loaded.ts"],
		["--kind", "cli"],
		["--reps", "2"],
		["--parallel", "2"],
		["--target", "codex:extra"],
		["--allow-unmetered"],
		["--turns", "101"],
		["--milliseconds", "600001"],
		["--tokens", "1000001", "--max-tokens", "3000000"],
		["--max-tokens", "1999999"],
		["--max-usd", "3.99"],
	].map((extra) => ({ extra })),
)(
	"refuses expansion or inadequate aggregate admission: %j",
	async ({ extra }) => {
		await expect(
			fastCli([...args, ...extra], new MemoryLogger()),
		).rejects.toThrow();
	},
);

it("plans an explicitly selected probe", async () => {
	const log = new MemoryLogger();
	await fastCli([...unselected, "--probe", "decisions/answer"], log);
	expect(log.entries.map((entry) => entry.message).join("\n")).toContain(
		"Unchanged baseline (no candidate comparison): 1 cells",
	);
});

it("plans an explicitly selected aspect", async () => {
	const log = new MemoryLogger();
	await fastCli([...unselected, "--aspect", "decisions"], log);
	expect(log.entries.map((entry) => entry.message).join("\n")).toContain(
		"Unchanged baseline (no candidate comparison): 7 cells",
	);
});

it("requires one target from each family", async () => {
	await expect(
		fastCli(
			args.map((arg) => (arg === "claude:fixture" ? "codex:other" : arg)),
			new MemoryLogger(),
		),
	).rejects.toThrow("both Codex and Claude");
});

it("requires an explicit probe selection", async () => {
	await expect(
		fastCli(
			args.filter(
				(arg) => !["--probe", "decisions/local-choice"].includes(arg),
			),
			new MemoryLogger(),
		),
	).rejects.toThrow("requires an explicit --probe");
});

it("rejects a real diff instead of using the exception to select a candidate", async () => {
	await writeFile(join(skill, "SKILL.md"), "# Changed fixture\n");
	await expect(fastCli(args, new MemoryLogger())).rejects.toThrow(
		"identical committed and current",
	);
	await expect(
		freezeSnapshots(await skillChange(skill, "HEAD"), directory, true),
	).rejects.toThrow("identical instruction snapshots");
});

it("freezes only current bytes and verifies their identity", async () => {
	const change = await skillChange(skill, "HEAD");
	const snapshots = await freezeSnapshots(change, directory, true);
	expect(snapshots).toEqual([
		{
			role: "current",
			hash: change.afterHash,
			source: join(directory, "current"),
		},
	]);
	await verifySnapshot(join(directory, "current"), change.afterHash);
	expect(await readdir(directory)).not.toContain("candidate");
	expect(await readdir(directory)).not.toContain("baseline");
});

it("cannot execute without terminal confirmation even when unchanged admission fits", async () => {
	const script = `import { fastCli } from ${JSON.stringify(join(import.meta.dir, "probe-cli.ts"))}; try { await fastCli(process.argv.slice(1)); } catch (error) { console.log(error.message); }`;
	const result = await exec(process.execPath, [
		"-e",
		script,
		"fast",
		...args.slice(1),
		"--directory",
		join(directory, "results"),
	]);
	expect(result.stdout).toContain(
		"Paid experiment probes require a terminal and confirmation",
	);
	expect(await readdir(directory)).not.toContain("results");
});

const exec = promisify(execFile);
let directory: string;
let skill: string;
let args: string[];
let claudeOnly: string[];
let unselected: string[];
beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), "unchanged-baseline-"));
	skill = join(directory, "skills/splates");
	await mkdir(skill, { recursive: true });
	await writeFile(join(skill, "SKILL.md"), "# Unchanged fixture\n");
	await exec("git", ["init", "-q"], { cwd: directory });
	await exec("git", ["add", "."], { cwd: directory });
	await exec(
		"git",
		[
			"-c",
			"user.name=Test",
			"-c",
			"user.email=test@example.test",
			"commit",
			"-qm",
			"fixture",
		],
		{ cwd: directory },
	);
	args = [
		"plan",
		"--unchanged-baseline",
		"--baseline",
		"HEAD",
		"--skill",
		skill,
		"--probe",
		"decisions/local-choice",
		"--target",
		"codex:fixture",
		"--target",
		"claude:fixture",
	];
	const index = args.indexOf("codex:fixture");
	claudeOnly = [...args.slice(0, index - 1), ...args.slice(index + 1)];
	unselected = claudeOnly.filter(
		(arg) => !["--probe", "decisions/local-choice"].includes(arg),
	);
});
afterEach(async () => {
	await rm(directory, { recursive: true, force: true });
});
