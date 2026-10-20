import { limited, READ_CONCURRENCY } from "../limited";
import type { WorktreeService } from "./worktree-service";

/** Compares new work with files already being changed by open tasks. */
export class TaskOverlaps {
	constructor(private readonly service: WorktreeService) {}

	async files(): Promise<{ task: string; files: string[] }[]> {
		return limited(
			(await this.service.list()).filter((each) => each.hasBranch),
			READ_CONCURRENCY,
			async (each) => ({
				task: each.task,
				files: (await each.changedFiles()) ?? [],
			}),
		);
	}

	async warnings(
		task: string,
		goal: string,
		changed: string[] = [],
	): Promise<string[]> {
		return overlapWarnings(await this.files(), task, goal, changed);
	}
}

/** Names open work that touches a file named in the goal or already changed here. */
export function overlapWarnings(
	peers: { task: string; files: string[] }[],
	task: string,
	goal: string,
	changed: string[] = [],
): string[] {
	const own = new Set(changed);
	return peers.flatMap((other) => {
		if (other.task === task) {
			return [];
		}
		const files = other.files.filter(
			(path) => own.has(path) || goal.includes(path),
		);
		return files.length === 0
			? []
			: [
					`overlap with ${other.task}: ${files.join(", ")}; coordinate the work or queue it with --blocked-by`,
				];
	});
}
