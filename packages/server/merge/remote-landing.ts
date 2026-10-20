import type { Git } from "../git";
import type { Worktree } from "../tasks";
import type { TaskBranches } from "./branches";
import type { Landed, TrunkLanding } from "./trunk";

/**
 * Pushes the tested branch as `splates/<task>` and asks the coordinator to
 * move the remote's trunk to it from `onto`, the commit it was tested on.
 */
export async function landOnRemote({
	git,
	branches,
	trunk,
	worktree,
	remote,
	onto,
	relayed,
	holder,
}: {
	git: Git;
	branches: TaskBranches;
	trunk: TrunkLanding;
	worktree: Worktree;
	remote: string;
	onto: string;
	relayed: boolean;
	holder: { pid: number; hostname: string };
}): Promise<Landed> {
	const pushed = await branches.pushTree(worktree);
	if (pushed.status !== "pushed") {
		return {
			status: "refused",
			why: `${branches.pushedBranch(worktree.task)} was not pushed to ${remote}: ${pushed.status === "off" ? "no remote is configured" : pushed.why}`,
		};
	}
	const head = await git.head(worktree.path);
	const landed = await trunk.land({
		task: worktree.task,
		onto,
		head,
		holder,
	});
	if (landed.status === "landed" && relayed) {
		await worktree.moveBase(head);
	}
	return landed;
}
