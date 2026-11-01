import type { Logger } from "core/log";
import { SystemClock } from "core/time";
import { Exit, fail } from "../exit";
import type { Facts, Repository } from "../records";
import type { ServerOf } from "../workers";
import { mergeOnServer, type ServedOutcome } from "./client";
import { finishLanding } from "./finish";
import { refuseUnready } from "./preflight";
import { MergeTiming } from "./timing";

/**
 * Merges a task of this worker through the server with a central remote:
 * pushes its branch untested, has the server rebase, gate and land it in its
 * own line, then ends the task here as a landing does. A refusal brings back
 * the merge budget the server charged, saved here; `unreachable` leaves the
 * worker to merge itself.
 */
export async function mergeViaServer(
	ctx: Repository & { log: Logger },
	{
		server,
		slug,
		task,
		message,
		facts,
	}: {
		server: ServerOf;
		slug: string;
		task: string;
		message: string;
		facts: Partial<Facts["merge"]>;
	},
): Promise<ServedOutcome | "own"> {
	const { service, git, branches } = ctx;
	const worktree = await service.find(task);
	if (worktree.state === null || worktree.base !== ctx.config.trunk) {
		return "own";
	}
	await refuseUnready(ctx, worktree);
	const pushed = await branches.pushTree(worktree);
	if (pushed.status !== "pushed") {
		fail(
			"blocked",
			`could not push ${branches.pushedBranch(task)} for the server to merge: ${pushed.status === "off" ? "no remote is configured" : pushed.status === "refused" || pushed.status === "failed" ? pushed.why : ""}\nNo merge attempt was spent: merge again once it can be pushed.`,
			{ task },
		);
	}
	const changed = (await worktree.changedFiles()) ?? [];
	const commits = (await worktree.commitMessages()) ?? undefined;
	const size = (await worktree.size()) ?? undefined;
	const head = await git.head(worktree.path);
	try {
		const outcome = await mergeOnServer(
			{ server, slug, log: ctx.log },
			{
				task,
				cwd: worktree.path,
				pid: ctx.service.ps.pid,
				hostname: ctx.service.ps.hostname,
				env: Object.fromEntries(
					Object.entries(process.env).filter(
						(each): each is [string, string] => each[1] !== undefined,
					),
				),
				message,
				remote: {
					head,
					attempts: worktree.mergeAttempts,
					conflicts: worktree.conflictAttempts,
				},
			},
			facts,
		);
		if (outcome !== "landed") {
			return outcome;
		}
	} catch (error) {
		if (error instanceof Exit) {
			const { attempts, conflicts } = error.data as {
				attempts?: number;
				conflicts?: number;
			};
			if (typeof attempts === "number" && typeof conflicts === "number") {
				await (await service.find(task)).save({
					mergeAttempts: attempts,
					conflictAttempts: conflicts,
					status: "working",
				});
			}
		}
		throw error;
	}
	using timing = new MergeTiming({}, new SystemClock());
	await finishLanding(
		{ ...ctx, timing },
		{
			current: await service.find(task),
			head: facts.commit ?? head.slice(0, 7),
			landing: git.root,
			landed: null,
			changed: facts.files ?? changed,
			commits,
			size,
			testTimes: [],
		},
		facts,
	);
	return "landed";
}
