import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commandsOf } from "./agents";
import type { ContractDetail } from "./contract";
import { repoAt } from "./sandbox";
import type { Outcome, Repo } from "./scenario";

/** A run's repo as it ended: every commit as a git bundle, and the uncommitted work as a patch. */
export interface RepoSnapshot {
	bundle: Uint8Array;
	diff: string;
}

/** Captures `repo` as it stands, or null when it cannot be (the run is graded either way). */
export async function snapshotRepo(repo: Repo): Promise<RepoSnapshot | null> {
	const scratch = await mkdtemp(join(await realTmp(), "eval-keep-"));
	try {
		const file = join(scratch, "repo.bundle");
		await repo.run(["git", "bundle", "create", "-q", file, "--all"]);
		// Intent-to-add makes new files show up in the diff; the sandbox is removed after.
		await repo.run(["git", "add", "-N", "."]);
		const diff = await repo.run(["git", "diff", "HEAD", "--binary"]);
		return { bundle: new Uint8Array(await readFile(file)), diff };
	} catch {
		return null;
	} finally {
		await rm(scratch, { recursive: true, force: true });
	}
}

/** The files a snapshot is saved as beside run `cell`. */
export function snapshotFiles(cell: string): { bundle: string; diff: string } {
	return { bundle: `${cell}.bundle`, diff: `${cell}.diff` };
}

/** Writes `snapshot` into `dir` for run `cell`, returning the `repo` field of its detail file. */
export async function saveSnapshot(
	dir: string,
	cell: string,
	snapshot: RepoSnapshot,
): Promise<NonNullable<ContractDetail["repo"]>> {
	const files = snapshotFiles(cell);
	await writeFile(join(dir, files.bundle), snapshot.bundle);
	if (snapshot.diff !== "") {
		await writeFile(join(dir, files.diff), snapshot.diff);
		return files;
	}
	return { bundle: files.bundle };
}

/** A restored run: the `Outcome` its checks got, in a throwaway repo that `remove` deletes. */
export interface Restored {
	outcome: Outcome;
	remove(): Promise<void>;
}

/**
 * Restores run `cell` of the batch in `dir` into a throwaway repo and gives
 * back the `Outcome` its checks got. Throws when the run kept no repo (a batch
 * from before they were kept, or a run that errored).
 */
export async function restoreRun(
	dir: string,
	cell: string,
	env: Record<string, string> = { ...(process.env as Record<string, string>) },
): Promise<Restored> {
	const detail = JSON.parse(
		await readFile(join(dir, `${cell}.json`), "utf8"),
	) as ContractDetail;
	if (detail.repo === undefined) {
		throw new Error(`${cell} kept no repo`);
	}
	const root = await mkdtemp(join(await realTmp(), "eval-restore-"));
	const remove = () => rm(root, { recursive: true, force: true });
	try {
		const target = join(root, "repo");
		const scratch = repoAt(root, { ...env, GIT_CONFIG_NOSYSTEM: "1" });
		await scratch.run([
			"git",
			"clone",
			"-q",
			join(dir, detail.repo.bundle),
			target,
		]);
		const repo = repoAt(target, {
			...env,
			PWD: target,
			GIT_CONFIG_NOSYSTEM: "1",
		});
		await repo.run(["git", "config", "user.name", "Eval seed"]);
		await repo.run(["git", "config", "user.email", "eval@example.invalid"]);
		if (detail.repo.diff !== undefined) {
			await repo.run(["git", "apply", join(dir, detail.repo.diff)]);
		}
		const transcript = detail.transcript ?? [];
		return {
			outcome: {
				reply: detail.reply ?? "",
				transcript,
				commands: commandsOf(transcript),
				repo,
			},
			remove,
		};
	} catch (error) {
		await remove();
		throw error;
	}
}

function realTmp(): Promise<string> {
	return realpath(tmpdir());
}
