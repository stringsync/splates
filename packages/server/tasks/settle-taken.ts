import type { Tasks } from "../board";
import type { WorktreeService } from "./worktree-service";

/**
 * Finishes board cleanup for any task still marked taken by a worktree task
 * that already finished (merged or removed without deferral), as when a merge
 * or remove process is interrupted after discarding the worktree.
 */
export async function settleTaken(
	tasks: Tasks,
	service: WorktreeService,
): Promise<number> {
	const taken = (await tasks.all()).filter((each) => each.takenBy !== null);
	if (taken.length === 0) {
		return 0;
	}
	const live = new Set((await service.states()).map((each) => each.task));
	const stranded = taken.filter(
		(each) => each.takenBy !== null && !live.has(each.takenBy),
	);
	if (stranded.length === 0) {
		return 0;
	}
	const finished = await service.finished.list();
	const lanes = new Set<number>();
	let settled = 0;
	for (const each of stranded) {
		const ended = finished.find(
			(fin) =>
				fin.task === each.takenBy &&
				(fin.id === each.id || fin.took.some((took) => took.id === each.id)),
		);
		if (ended === undefined) {
			continue;
		}
		if (ended.ended === "merged") {
			await each.remove(ended.commit ?? undefined);
			if (each.lane !== null) {
				lanes.add(each.lane);
			}
			settled += 1;
		} else if (ended.ended === "removed" && ended.reason !== "blocked") {
			await each.remove();
			if (each.lane !== null) {
				lanes.add(each.lane);
			}
			settled += 1;
		}
	}
	if (lanes.size > 0) {
		await tasks.endLanes([...lanes]);
	}
	return settled;
}
