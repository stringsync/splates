import { readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { Json } from "./probe";
import type { RunContext } from "./probe-record";

export function inside(root: string, path: string): boolean {
	const suffix = relative(root, path);
	return suffix !== ".." && !suffix.startsWith("../") && !isAbsolute(suffix);
}

/** Resolve only the frozen decision fixture's task and private metadata as writable roots. */
export async function fixtureWriteRoots(
	context: Pick<RunContext, "probe" | "runtime" | "isolation">,
): Promise<string[]> {
	if (
		context.probe.seed.id !== "decisions/task" ||
		context.probe.seed.version !== "1" ||
		typeof context.runtime.decisionPath !== "string"
	) {
		throw new Error(
			"Fixture writes require the seeded decisions/task@1 worktree",
		);
	}
	const run = await realpath(dirname(context.isolation.repository));
	const repository = await realpath(context.isolation.repository);
	const task = await realpath(context.runtime.decisionPath);
	const metadata = await realpath(join(repository, ".git/splates"));
	const home = await realpath(context.isolation.splatesHome);
	if (
		repository !== join(run, "repo") ||
		metadata !== join(repository, ".git/splates") ||
		home !== join(run, "splates-home") ||
		task === run ||
		!inside(run, task) ||
		inside(repository, task) ||
		inside(home, task)
	) {
		throw new Error(
			"Fixture write roots escape the isolated run or overlap reserved directories",
		);
	}
	const pointer = /^gitdir: (.+)\n?$/.exec(
		await readFile(join(task, ".git"), "utf8"),
	);
	if (!pointer?.[1]) {
		throw new Error("Fixture task is not a linked worktree");
	}
	const gitdir = await realpath(resolve(task, pointer[1]));
	if (!inside(join(repository, ".git/worktrees"), gitdir)) {
		throw new Error("Fixture task belongs to a different repository");
	}
	return [task, metadata, home];
}

/** Require every requested extra root and refuse any wider returned root. Cwd is implicitly writable. */
export function confirmsRoots(
	actual: Json | undefined,
	cwd: string,
	extra: string[],
): boolean {
	return (
		Array.isArray(actual) &&
		actual.every(
			(root) =>
				typeof root === "string" && (root === cwd || extra.includes(root)),
		) &&
		extra.every((root) => actual.includes(root))
	);
}
