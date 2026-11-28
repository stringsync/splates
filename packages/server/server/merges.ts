// vet-ignore-file doc-comments-address-users: its doc comments predate the rule

import type {
	Conversation,
	ConversationHost,
	Conversations,
	PlanTrust,
	PlanTrusted,
} from "../conversations";
import { NoopConversations, planApproved, reviewHold } from "../conversations";
import { fail } from "../exit";
import {
	MergeAsk,
	merge,
	type RunMerge,
	ServedMerges,
	WorktreePs,
} from "../merge";
import { pickedModel } from "../models";
import { openRepository } from "../records";
import { openQuestions, type WorktreeService } from "../tasks";
import { allows, BAND_LABELS, type TrustStore } from "../trust";
import type { Project } from "./project-types";
import { refuse } from "./shared";

/** How long a read of a merge waits for something new, under a fetch's own timeout. */
export const MERGE_READ_WAIT_MS = 20_000;

/**
 * The routes that run the merges `splates merge` asks the server for, so a
 * task's edits to the merge code never run its own landing. Pass the
 * project's conversations to have a merge refuse while its task has a
 * question card nobody answered, and the trust scores to have one refuse
 * while an agent below ask-and-go trust has no approved plan.
 */
// `splates merge` asks for the merge, reads what it says until it ends, then
// says it has read the end.
export class MergeRoutes {
	readonly merges: ServedMerges;

	constructor(
		readonly project: Project,
		open: typeof openRepository = openRepository,
		conversations: Conversations | null = null,
		trust: TrustStore | null = null,
	) {
		this.merges = new ServedMerges({
			storage: project.storage,
			log: project.log,
			run: servedMerge(project, open, conversations, trust),
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
function servedMerge(
	project: Project,
	open: typeof openRepository,
	conversations: Conversations | null,
	trust: TrustStore | null,
): RunMerge {
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
				{
					...repository,
					premerge: project.premerge,
					log,
					asking: async (task) =>
						(
							await openQuestions(
								conversations ?? new NoopConversations(),
								task,
							)
						).map((asked) => asked.number),
					unapproved: async (task) =>
						trust === null || conversations === null
							? null
							: unapprovedWhy(
									project,
									trust,
									(await conversations.list()).filter(
										(each) => each.state.task === task && !each.state.archived,
									),
								),
					unreviewed: async (task) =>
						unreviewedWhy(
							(await (conversations ?? new NoopConversations()).list()).filter(
								(each) => each.state.task === task && !each.state.archived,
							),
						),
				},
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

/**
 * What reads, for a conversation in `project`, the trust that lets its agent
 * go ahead on a plan unapproved: the posture its merge would be gated on.
 */
export function planTrusting(project: Project, trust: TrustStore): PlanTrust {
	return (conversation) => planTrustOf(project, trust, conversation);
}

async function planTrustOf(
	project: Project,
	trust: TrustStore,
	conversation: ConversationHost,
): Promise<PlanTrusted | null> {
	const posture = await postureOf(project, trust, conversation);
	return allows(posture.band, "merge-without-approval")
		? { band: posture.band, score: posture.entry.score }
		: null;
}

function postureOf(
	project: Project,
	trust: TrustStore,
	conversation: Pick<ConversationHost, "state">,
) {
	const { task, lastTask, agent, settings } = conversation.state;
	const target = task ?? lastTask;
	return trust.postureOfWork(
		{
			project: project.service.git.root,
			agent,
			model: pickedModel(settings),
		},
		async () => {
			if (target === null) {
				return null;
			}
			const live = await project.service
				.find(target)
				.then((worktree) => worktree.changedFiles())
				.catch(() => null);
			if (live !== null) {
				return live;
			}
			return await trust.latestTaskFiles(project.service.git.root, target);
		},
	);
}

/**
 * Why a task worked in `talks`, newest first, cannot land yet: its newest
 * agent is below ask-and-go trust and none of them had a plan approved.
 * Null when one did, the agent's trust lets it go on its own, or no
 * conversation works the task.
 */
export async function unapprovedWhy(
	project: Project,
	trust: TrustStore,
	talks: readonly Conversation[],
): Promise<string | null> {
	const newest = talks[0];
	if (newest === undefined || talks.some((each) => planApproved(each.state))) {
		return null;
	}
	const posture = await postureOf(project, trust, newest);
	if (allows(posture.band, "merge-without-approval")) {
		return null;
	}
	return `Below ask-and-go trust (with trusted decisions enabled), a merge needs the user's approval of the task's plan, and this conversation is in the ${BAND_LABELS[posture.band]} band with no approved plan: post one Plan card for the design and end your turn; its approval covers the edits through the merge.`;
}

/**
 * Why a task worked in `talks` cannot land before the user reviews it: one
 * of them approved its plan with Approve & review or has a One-way or
 * Invasive plan without a merge review approval since. Holds at every trust
 * level. Null when none did.
 */
export function unreviewedWhy(talks: readonly Conversation[]): string | null {
	const hold = talks
		.map((each) => reviewHold(each.state))
		.find((each) => each !== null);
	if (hold === undefined) {
		return null;
	}
	const lead =
		hold === "one-way"
			? "This plan carries the One-way tag, so it lands only after the user approves a merge review"
			: hold === "invasive"
				? "This plan carries the Invasive tag, so it lands only after the user approves a merge review"
				: "The user approved this plan with Approve & review, so it lands only after they approve a merge review";
	return `${lead}: send the Ready to merge report, keeping \`- [ ] Show the user before merging\` under \`## Next\`, and end your turn; merge once they reply \`[SPLATES MERGE]\`.`;
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
