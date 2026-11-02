import { fail } from "../exit";
import {
	MergeAsk,
	merge,
	type RunMerge,
	ServedMerges,
	WorktreePs,
} from "../merge";
import { openRepository } from "../records";
import type { WorktreeService } from "../tasks";
import type { Project } from "./project-types";
import { refuse } from "./shared";

/** How long a read of a merge waits for something new, under a fetch's own timeout. */
export const MERGE_READ_WAIT_MS = 20_000;

/**
 * The routes `splates merge` hands its merge to the server by: it asks for
 * the merge, reads what the merge says until it ends, then says it has read
 * the end. The server runs every merge with its own merge code, so a task's
 * edits to that code never run its own landing.
 */
export class MergeRoutes {
	readonly merges: ServedMerges;

	constructor(
		readonly project: Project,
		open: typeof openRepository = openRepository,
	) {
		this.merges = new ServedMerges({
			storage: project.storage,
			log: project.log,
			run: servedMerge(project, open),
		});
	}

	readonly startMerge = async (request: Request): Promise<Response> => {
		const parsed = MergeAsk.safeParse(await request.json().catch(() => null));
		if (!parsed.success) {
			return refuse(
				400,
				"usage",
				`not a merge to run: ${parsed.error.message}`,
			);
		}
		await this.merges.start(parsed.data);
		return Response.json({});
	};

	readonly readMerge = async (request: Request): Promise<Response> => {
		const url = new URL(request.url);
		const task = taskOf(url);
		const from = Number(url.searchParams.get("from") ?? "0");
		const wait = Number(url.searchParams.get("wait") ?? MERGE_READ_WAIT_MS);
		const answer = await this.merges.read(
			task,
			Number.isFinite(from) ? from : 0,
			Number.isFinite(wait) ? Math.min(wait, MERGE_READ_WAIT_MS) : 0,
		);
		return answer === null
			? refuse(404, "not_found", `no merge of '${task}' runs here`)
			: Response.json(answer);
	};

	readonly doneMerge = async (request: Request): Promise<Response> => {
		const url = new URL(request.url);
		await this.merges.done(
			taskOf(url),
			Number(url.searchParams.get("pid") ?? "0"),
		);
		return Response.json({});
	};
}

function taskOf(url: URL): string {
	return decodeURIComponent(url.pathname.split("/")[3] ?? "");
}

/**
 * Runs `ask`'s merge in its worktree as `splates merge` would have there,
 * with the server's process for its pid, then gives the task's lease back
 * to the command waiting on it, so its agent carries on with the task once
 * it ends.
 */
function servedMerge(project: Project, open: typeof openRepository): RunMerge {
	return async (ask, log, facts) => {
		const ps = new WorktreePs(project.ps, ask);
		const repository = await open({ fs: project.fs, ps, log }, { at: ask.cwd });
		try {
			if (repository.git.root !== project.service.git.root) {
				fail(
					"not_found",
					`${ask.cwd} is not in ${project.service.git.root}, the project asked`,
					{ task: ask.task },
				);
			}
			// The project's one premerge lock, whose tickets tell this process's
			// merges apart, and whose bumps the page sends it.
			await merge(
				{ ...repository, premerge: project.premerge, log },
				ask.cwd,
				facts,
				{
					message: ask.message,
				},
			);
		} finally {
			try {
				await handBack(repository.service, ask);
			} finally {
				repository.dispose();
			}
		}
	};
}

/** Gives a task the server's merge holds back to the `splates merge` that asked. */
async function handBack(
	service: WorktreeService,
	ask: MergeAsk,
): Promise<void> {
	const worktree = await service.find(ask.task);
	const { lease } = worktree;
	if (worktree.state === null || lease === null || !worktree.leaseOurs) {
		return;
	}
	await worktree.save({
		lease: {
			...lease,
			pid: ask.pid,
			hostname: ask.hostname,
			heartbeatAt: new Date().toISOString(),
		},
	});
}
