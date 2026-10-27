import { expect, test } from "bun:test";
import type { Fs } from "webappwiz/system";
import type { Git, GitResult } from "../git";
import { WorktreeCheckouts } from "./worktree-checkouts";

const done: GitResult = { code: 0, stdout: "", stderr: "" };

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

	const result = await new WorktreeCheckouts(git, fs).remove(
		"/trees/alpha",
		"task/alpha",
	);

	expect(result).toEqual(done);
	expect(removals).toBe(2);
});
