import type { WorktreeService } from "../tasks";
/**
 * Takes `gate`, `mergeSince` and `mergePlace` off the task's record once its merge ends, landed or not, so
 * a later lease on it shows no merge under way. A landed task has no record
 * left to change.
 */
export async function clearGate(
	service: WorktreeService,
	task: string,
): Promise<void> {
	const worktree = await service.find(task).catch(() => null);
	const state = worktree?.state;
	if (state?.gate !== undefined || state?.mergeSince !== undefined) {
		await worktree?.save({
			gate: undefined,
			mergeSince: undefined,
			mergePlace: undefined,
		});
	}
}
