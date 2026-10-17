import { join, relative, resolve, sep } from "node:path";

/** A file to open, and the tree its editor window should hold. */
export interface InTree {
	tree: string;
	file: string;
}

/**
 * Where `path` opens: inside the task worktree under `worktrees` it is in,
 * or, once that worktree is gone, at the same place in the main tree `root`,
 * or inside `root` itself. Null for a path in neither, which the page may not
 * open.
 */
export async function inTree(
	path: string,
	{ root, worktrees }: { root: string; worktrees: string },
	exists: (path: string) => Promise<boolean>,
): Promise<InTree | null> {
	const file = resolve(path);
	if (file.startsWith(worktrees + sep)) {
		const [task = "", ...rest] = relative(worktrees, file).split(sep);
		const tree = join(worktrees, task);
		return (await exists(tree))
			? { tree, file }
			: { tree: root, file: join(root, ...rest) };
	}
	return file === root || file.startsWith(root + sep)
		? { tree: root, file }
		: null;
}
