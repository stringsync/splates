import type { Logger } from "webappwiz/log";
import type { TaskBranches } from "../merge";
import { workerGit } from "../workers";
import type { WorkerMachines, WorktreeService } from "./worktree-service";

/** The name a stranded clone is pushed as: `splates/<task>-<worker>`. */
export function strandedBranch(task: string, machine: string): string {
	return `${task}-${machine.replace(/[^A-Za-z0-9._-]/g, "-")}`;
}

/**
 * Looks at each clone of a task left behind on worker `machine`, now it has
 * rejoined, which the task carried on from elsewhere while the worker was
 * away. A clone with commits its last push lacks is pushed as
 * `splates/<task>-<machine>`, and the task's record says so for its agent's
 * next claim; the rest are let go. One that cannot be reached stays for
 * the next time the worker joins.
 */
export async function rescueStranded(
	machine: string,
	opts: RescueOptions,
): Promise<void> {
	const { service, machines, branches, log } = opts;
	const worker = machines.machine(machine);
	const remote = service.config.remote;
	if (worker === null || remote === null) {
		return;
	}
	for (const state of await service.states()) {
		for (const tree of state.stranded ?? []) {
			if (tree.machine !== machine) {
				continue;
			}
			try {
				if (!(await worker.exists(tree.path))) {
					await settle(service, state.task, tree.path, null);
					continue;
				}
				const git = workerGit(tree.path, worker);
				const since = await git.run(
					tree.path,
					"rev-list",
					"--count",
					`refs/remotes/${remote}/splates/${state.task}..refs/heads/${tree.branch}`,
				);
				const commits = since.code === 0 ? Number(since.stdout) : 0;
				if (!(commits > 0)) {
					await settle(service, state.task, tree.path, null);
					continue;
				}
				const pushed = await branches.push(state.task, tree.branch, {
					at: git,
					as: strandedBranch(state.task, machine),
				});
				if (pushed.status !== "pushed") {
					log.error(
						`could not push the ${commits} commit(s) of ${state.task} left on worker ${machine}: ${pushed.status === "off" ? "no remote" : pushed.status === "refused" ? pushed.why : pushed.why}`,
					);
					continue;
				}
				log.info(
					`worker ${machine} rejoined with ${commits} commit(s) of ${state.task} the task carried on without: pushed as ${pushed.branch}`,
				);
				await settle(service, state.task, tree.path, {
					machine,
					branch: pushed.branch,
					commits,
				});
			} catch (error) {
				log.error(
					`could not look at ${state.task}'s clone on worker ${machine}: ${String(error)}`,
				);
			}
		}
	}
}

/** What `rescueStranded` reaches the worker and the remote through. */
export interface RescueOptions {
	service: WorktreeService;
	machines: WorkerMachines;
	branches: TaskBranches;
	log: Logger;
}

/** Drops the stranded clone at `path` from `task`'s record, noting what was pushed from it. */
function settle(
	service: WorktreeService,
	task: string,
	path: string,
	rescued: { machine: string; branch: string; commits: number } | null,
): Promise<void> {
	return service.amend(task, (state) => {
		const stranded = (state.stranded ?? []).filter(
			(each) => each.path !== path,
		);
		const { stranded: _, ...rest } = state;
		return {
			...rest,
			...(stranded.length === 0 ? {} : { stranded }),
			...(rescued === null
				? {}
				: { rescued: [...(state.rescued ?? []), rescued] }),
		};
	});
}
