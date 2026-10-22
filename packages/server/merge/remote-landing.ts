import type { Worktree } from "../tasks";
import type { Landed, TrunkLanding } from "./trunk";

/**
 * Asks the server to land an already pushed, tested branch and
 * move the remote's trunk to it from `onto`, the commit it was tested on.
 */
export async function landOnRemote({
	trunk,
	worktree,
	onto,
	head,
	relayed,
	holder,
}: {
	trunk: TrunkLanding;
	worktree: Worktree;
	onto: string;
	head: string;
	relayed: boolean;
	holder: { pid: number; hostname: string };
}): Promise<Landed> {
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
