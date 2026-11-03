import { expect, test } from "bun:test";
import type { Fs } from "core/system";
import type { Git, GitResult } from "../git";
import { WorktreeCheckouts } from "./worktree-checkouts";

const done: GitResult = { code: 0, stdout: "", stderr: "" };
const noDocker = {
	spawnCapture: async () => {
		throw new Error("spawn docker ENOENT");
	},
} as never;

test("retries removing an unregistered worktree while the directory is not empty", async () => {
	let removals = 0;
	const outcomes = [
		Promise.reject(
			Object.assign(new Error("directory not empty"), { code: "ENOTEMPTY" }),
		),
		Promise.resolve(),
	];
	const fs = {
		exists: async () => true,
		rm: async () => outcomes[removals++],
	} as unknown as Fs;
	const git = {
		removeWorktree: async () => ({
			code: 1,
			stdout: "",
			stderr: "'/trees/alpha' is not a working tree",
		}),
		pruneWorktrees: async () => done,
		branchExists: async () => false,
	} as unknown as Git;

	const result = await new WorktreeCheckouts(git, fs, noDocker).remove(
		"/trees/alpha",
		"task/alpha",
	);

	expect(result).toEqual(done);
	expect(removals).toBe(2);
});

test("stops a Compose stack mounting the worktree before removing it", async () => {
	const calls: string[][] = [];
	const id = "a".repeat(12);
	const other = "b".repeat(12);
	const inspected = `${id}\talpha\t/trees/alpha/data\n/var/lib/x\n\n${other}\tbeta\t/trees/beta/data\n\n`;
	const ps = {
		spawnCapture: async (argv: string[]) => {
			calls.push(argv.slice(1));
			const stdout =
				argv[1] === "ps"
					? `${id}\n${other}\n`
					: argv[1] === "inspect"
						? inspected
						: "";
			return { exitCode: 0, stdout, stderr: "" };
		},
	};
	const fs = { exists: async () => true } as unknown as Fs;
	const git = {
		removeWorktree: async () => {
			calls.push(["git-remove"]);
			return done;
		},
		branchExists: async () => false,
	} as unknown as Git;

	await new WorktreeCheckouts(git, fs, ps as never).remove(
		"/trees/alpha",
		"task/alpha",
	);

	expect(calls).toContainEqual(["compose", "-p", "alpha", "down", "-v"]);
	expect(calls).not.toContainEqual(["compose", "-p", "beta", "down", "-v"]);
	expect(calls.at(-1)).toEqual(["git-remove"]);
});

test("removes the worktree when docker is absent", async () => {
	const ps = {
		spawnCapture: async () => {
			throw new Error("spawn docker ENOENT");
		},
	};
	const fs = { exists: async () => true } as unknown as Fs;
	const git = {
		removeWorktree: async () => done,
		branchExists: async () => false,
	} as unknown as Git;

	const result = await new WorktreeCheckouts(git, fs, ps as never).remove(
		"/trees/alpha",
		"task/alpha",
	);

	expect(result).toEqual(done);
});
