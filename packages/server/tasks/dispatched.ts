import type { Logger } from "webappwiz/log";
import {
	type Conversation,
	type Conversations,
	SERVER_TOLD,
} from "../conversations";
import { effortSettings, modelOption } from "../models";
import { taskReference } from "../plans";
import type { Dispatched, Worktree } from "./worktree";
import type { WorktreeService } from "./worktree-service";

/**
 * Starts the agent of each task `splates server`'s queue handed to one and
 * that has none yet, in the task's tree, on the model and thinking level
 * asked for, told to claim it: in the conversation the queue held for it,
 * when there is one. Safe to call again: a task is started once, as long
 * as no two runs overlap. Answers once each is started, not told.
 */
export async function startDispatched({
	service,
	conversations,
	log,
}: {
	service: WorktreeService;
	conversations: Conversations;
	log: Logger;
}): Promise<void> {
	for (const worktree of await service.list()) {
		const dispatch = worktree.state?.dispatch;
		if (
			dispatch === undefined ||
			dispatch.conversation !== undefined ||
			// Pending while its `splates add` still runs; one that died leaves the
			// lease it took stale, and the tree as the hook left it, which the
			// agent can mend.
			(dispatch.pending === true && worktree.leaseHeld) ||
			!worktree.exists
		) {
			continue;
		}
		// One that cannot start, as on an agent splates no longer runs, holds
		// up none after it; it is tried again on the next run.
		try {
			await startOne(worktree, dispatch, conversations, log);
		} catch (error) {
			log.error(
				`${dispatch.agent} could not start on ${worktree.task}, and is tried again: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
}

/** Starts the agent `dispatch` hands `worktree`'s task to, as `startDispatched` says. */
async function startOne(
	worktree: Worktree,
	dispatch: Dispatched,
	conversations: Conversations,
	log: Logger,
): Promise<void> {
	const offered = (await conversations.settings())[dispatch.agent] ?? [];
	const held = await heldFor(conversations, dispatch.held);
	if (held !== null) {
		held.release(worktree.task, worktree.path, worktree.base, worktree.caller);
	}
	const conversation =
		held ??
		(await conversations.start(dispatch.agent, {
			task: worktree.task,
			base: worktree.base,
			caller: worktree.caller,
			cwd: worktree.path,
			model: dispatch.model,
			settings: effortSettings(dispatch.effort, offered),
			assigned: true,
			// Answers to the person; the lane's orchestrator that started it
			// only hears when it stops.
			startedBy: worktree.caller,
		}));
	const { pending: _, ...settled } = dispatch;
	await worktree.save({
		dispatch: { ...settled, conversation: conversation.id },
		...(dispatch.pending === true ? { lease: null } : {}),
	});
	// Each agent takes its time to start, so none waits on another's.
	void (async () => {
		await conversation.prompt(
			[taskReference(worktree.task), dispatch.prompt ?? ""]
				.filter((each) => each !== "")
				.join("\n\n"),
			[],
			undefined,
			// Said by whoever handed it out, or by splates itself, not the person.
			{ told: worktree.caller ?? SERVER_TOLD },
		);
		// Told once the session is open, so its settings are known by now.
		if (
			dispatch.model !== undefined &&
			modelOption(conversation.state.settings, dispatch.model) === null
		) {
			log.error(
				`${dispatch.agent} offers no model '${dispatch.model}': ${worktree.task} started on its own`,
			);
		}
		if (
			dispatch.effort !== undefined &&
			Object.keys(effortSettings(dispatch.effort, offered)).length === 0
		) {
			log.error(
				`${dispatch.agent} offered no thinking level when ${worktree.task} started: it works at its own`,
			);
		}
	})().catch((error: unknown) =>
		log.error(
			`${dispatch.agent} did not take ${worktree.task}: ${error instanceof Error ? error.message : String(error)}`,
		),
	);
}

/**
 * The conversation the queue held for a task, `id`, while it still waits
 * for it; null for none, or one archived or let go meanwhile.
 */
async function heldFor(
	conversations: Conversations,
	id: string | undefined,
): Promise<Conversation | null> {
	if (id === undefined) {
		return null;
	}
	const held = await conversations.find(id).catch(() => null);
	return held === null || held.state.archived || held.state.heldForTask === null
		? null
		: held;
}
