import { relative } from "node:path";
import type { ListeningEntry, ProcessEntry } from "webappwiz/system";

/** What ties a process to a task: its worktree, and the agents at work in it. */
export interface PortOwners {
	worktrees: { task: string; path: string }[];
	/** The pid of each agent `arbor dev` runs in a task. */
	agents: { task: string; pid: number }[];
}

/** One port a task's processes listen on, on the worker that runs them. */
export interface TaskPort {
	task: string;
	port: number;
}

/**
 * The ports each task serves, as an editor finds the ports to forward: each
 * one a process listens on that runs in the task's worktree, or under one of
 * its agents, whatever directory it moved to. Each port once, in the order
 * of its task, then its number.
 */
export function taskPorts(
	table: ProcessEntry[],
	listening: ListeningEntry[],
	owners: PortOwners,
): TaskPort[] {
	const parents = new Map(table.map((each) => [each.pid, each.ppid]));
	const agents = new Map(owners.agents.map((each) => [each.pid, each.task]));
	// Up the tree to an agent; a cycle in a table read mid-change ends it.
	const agentOf = (pid: number): string | null => {
		const seen = new Set<number>();
		for (let at: number | undefined = pid; at !== undefined && at > 1; ) {
			if (seen.has(at)) {
				return null;
			}
			seen.add(at);
			const task = agents.get(at);
			if (task !== undefined) {
				return task;
			}
			at = parents.get(at);
		}
		return null;
	};
	const worktreeOf = (cwd: string | null): string | null =>
		cwd === null
			? null
			: (owners.worktrees.find(({ path }) => within(cwd, path))?.task ?? null);
	const found = new Map<number, TaskPort>();
	for (const each of listening) {
		const task = agentOf(each.pid) ?? worktreeOf(each.cwd);
		if (task !== null && !found.has(each.port)) {
			found.set(each.port, { task, port: each.port });
		}
	}
	return [...found.values()].sort(
		(one, other) => one.task.localeCompare(other.task) || one.port - other.port,
	);
}

/**
 * Whether `path` is `dir` or inside it, as `lsof` names it: macOS lists
 * what sits under `/var` and `/tmp` by their real path, under `/private`.
 */
function within(path: string, dir: string): boolean {
	const unprivate = (each: string) => each.replace(/^\/private(?=\/)/, "");
	const inside = relative(unprivate(dir), unprivate(path));
	return inside === "" || (!inside.startsWith("..") && !inside.startsWith("/"));
}
