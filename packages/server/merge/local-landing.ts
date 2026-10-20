import type { Git, GitResult } from "../git";

/** Lands one tested tip, refusing to overwrite a base that moved meanwhile. */
export async function landLocally({
	git,
	base,
	onto,
	head,
	landing,
}: {
	git: Git;
	base: string;
	onto: string;
	head: string;
	landing: string | null;
}): Promise<GitResult & { moved?: boolean }> {
	const ref = `refs/heads/${base}`;
	if (!(await git.isAncestor(onto, head))) {
		return {
			code: 1,
			stdout: "",
			stderr: "tested tip is not a fast-forward of its base",
		};
	}
	// Move only the ref we tested against. The tree is protected by the
	// landing lock (and a task tree lock when the base is another task).
	const swapped = await git.run(git.root, "update-ref", ref, head, onto);
	if (swapped.code !== 0) {
		return {
			...swapped,
			moved: (await git.out(git.root, "rev-parse", ref)) !== onto,
		};
	}
	if (landing === null) {
		return swapped;
	}
	// Two-tree unpack preserves noncolliding edits, and refuses colliding
	// edits or index.lock without discarding the holder's work.
	const checked = await git.run(landing, "read-tree", "-m", "-u", onto, head);
	if (checked.code !== 0) {
		const rolledBack = await git.run(git.root, "update-ref", ref, onto, head);
		return rolledBack.code === 0
			? checked
			: {
					...checked,
					stderr: `${checked.stderr}\nCould not restore ${base}: ${rolledBack.stderr}`,
				};
	}
	return checked;
}
