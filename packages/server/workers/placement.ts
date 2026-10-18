import type { Config } from "../config";
import type { PlacedCheckouts } from "../conversations";
import { materialize } from "../materialize";
import type { TaskBranches } from "../task-branches";
import type { WorktreeService } from "../worktree-service";
import type { WorkerMachine } from "./machine";

/**
 * Where a project's agents start on a remote worker: in their task's clone
 * when its record names that worker and the clone is still there, else in
 * the project's clone, readied by `materialize`, from which the agent's
 * `splates claim` clones the task again from `splates/<task>`. A task
 * checked out here as a worktree is pushed first, so that branch holds it.
 */
export class WorkerPlacement implements PlacedCheckouts {
	constructor(private readonly opts: WorkerPlacementOptions) {}

	async where(
		worker: string,
		machine: WorkerMachine,
		task: string | null,
	): Promise<string> {
		const { service, branches, config, slug } = this.opts;
		const found = task === null ? null : await service.find(task);
		if (found?.state != null) {
			if (found.machine === worker && (await machine.exists(found.path))) {
				return found.path;
			}
			if (found.machine === null) {
				const pushed = await branches.pushTree(found);
				if (pushed.status === "refused" || pushed.status === "failed") {
					throw new Error(`could not push ${found.branch}: ${pushed.why}`);
				}
			}
		}
		const named = await slug();
		if (named === null) {
			throw new Error("the project is not on this machine's list");
		}
		return materialize(machine, { slug: named, config, branches });
	}

	async elsewhere(task: string): Promise<boolean> {
		const found = await this.opts.service.find(task);
		return found.state !== null && found.machine !== null;
	}
}

/** The project `WorkerPlacement` places agents of. */
export interface WorkerPlacementOptions {
	service: Pick<WorktreeService, "find">;
	branches: TaskBranches;
	config: Pick<Config, "remote" | "trunk">;
	/** The project's slug, which names its clone on a worker; null for none. */
	slug: () => Promise<string | null>;
}
