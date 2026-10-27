import { color, type Logger } from "webappwiz/log";
import type { DeferralAsk, Task, Tasks } from "../board";
import { deferralProblem } from "../board";
import { fail } from "../exit";
import { pushedLine, type TaskBranches } from "../merge";
import { goalLine } from "../plans";
import { freedLine, type Slots } from "../ports";
import type { RemoveReason } from "./worktree";
import type { WorktreeService } from "./worktree-service";

export interface RemoveOptions {
	/** Discard the tree even when another agent holds its lease. */
	force?: boolean;
	/** The `splates server` conversation working on it, when removed from the page. */
	conversation?: string;
	/** Why, kept in its outcome for the Stats page. */
	reason?: RemoveReason;
	/**
	 * Why blocked work stopped and what it waits on, which `reason: "blocked"`
	 * requires, kept on the board task it goes back to.
	 */
	deferral?: Partial<DeferralAsk> & {
		/** The task's detail rewritten for whoever takes it next. */
		detail?: string;
	};
}

/**
 * Discards a whole task: `git worktree remove` plus the branch and the
 * record.
 *
 * Throwing a task away and redoing it against current trunk is usually cheaper
 * than a hard rebase, so this is meant to be used freely.
 *
 * What it took leaves the board too, unless blocked work is being deferred.
 * Deferred work goes back to ready or the backlog, outside the queue and
 * any queued lane until the person queues it again, holding why it stopped
 * and what it waits on; work that took no board task gets one of its own,
 * ready, so the deferral is kept somewhere.
 */
export async function remove(
	{
		service,
		log,
		tasks: queue,
		slots,
		branches,
	}: {
		service: WorktreeService;
		log: Logger;
		tasks: Tasks;
		slots: Slots;
		branches: TaskBranches;
	},
	task: string,
	{ force = false, conversation, reason, deferral = {} }: RemoveOptions = {},
): Promise<{ released: { id: number; subject: string }[] }> {
	const ask: DeferralAsk = {
		why: deferral.why ?? "",
		blockedBy: deferral.blockedBy ?? [],
		blockedElsewhere: deferral.blockedElsewhere ?? [],
		questions: deferral.questions ?? [],
		outside: deferral.outside ?? [],
	};
	const problem = reason === "blocked" ? deferralProblem(ask) : null;
	if (problem !== null) {
		fail("usage", problem, { task });
	}
	const worktree = await service.find(task);

	if (worktree.gone) {
		const removed = worktree.status === "removed";
		fail(
			removed ? "already_removed" : "not_found",
			removed
				? `'${task}' was already removed (${worktree.removedAt}), nothing left to remove`
				: `no worktree, branch or state file named '${task}', so it never existed here`,
			{ task },
		);
	}

	if (worktree.leaseHeldByOther) {
		if (!force) {
			fail(
				"lease_held",
				`'${task}' is held by pid ${worktree.lease?.pid} on ${worktree.lease?.hostname}: another agent is driving this tree. Leave it to that agent, or ask the user, who can pass --force to discard it anyway`,
				{ task, lease: worktree.lease },
			);
		}
		log.error(
			color.yellow(
				`splates: --force discarding a tree held by pid ${worktree.lease?.pid}`,
			),
		);
	}

	// Counted before the branch goes, so the report can say what was lost.
	const unlanded = worktree.hasBranch ? await worktree.commitsAhead() : 0;

	// Recorded before the tree goes, so a blocker that is refused loses nothing.
	let held: Task | null = null;
	if (reason === "blocked") {
		for (const id of ask.blockedBy) {
			await queue.find(id);
		}
		const holding = await queue.takenBy(task);
		if (holding.length === 0) {
			const plan = await service.finalPlan(worktree);
			held = await queue.add(goalLine(plan) ?? task, task, {
				slug: task,
				text: deferral.detail ?? plan,
				ready: true,
			});
			holding.push(held);
		}
		for (const each of holding) {
			await each.defer(ask, {
				task,
				conversation:
					conversation ?? worktree.state?.dispatch?.conversation ?? undefined,
				detail: each === held ? undefined : deferral.detail,
			});
		}
	}

	const discarded = await worktree.discard("removed", {
		conversation,
		reason,
		unqueue: true,
	});
	if (discarded.code !== 0) {
		fail("usage", `discarding '${task}' failed: ${discarded.stderr}`, {
			task,
		});
	}

	const freed = await slots.release(worktree.path);
	const deleted = pushedLine(await branches.delete(task), "deleted");

	const taken = await queue.takenBy(task);
	const released =
		reason === "blocked" ? [...taken, ...(held === null ? [] : [held])] : [];
	for (const each of taken) {
		if (reason === "blocked") {
			await each.release({ unqueue: true });
		} else {
			await each.remove();
		}
	}
	if (reason !== "blocked") {
		await queue.endLanes(
			taken.flatMap(({ lane }) => (lane === null ? [] : [lane])),
		);
	}
	await queue.skipInLanes(
		released.map(({ id }) => id),
		true,
	);

	const lines = [
		`${color.green("removed")} ${task}`,
		`  worktree: ${worktree.exists ? worktree.path : "already gone"}`,
		`  branch:   ${worktree.hasBranch ? worktree.branch : "already gone"}`,
		`  state:    ${worktree.state ? "removed" : "already gone"}`,
	];
	if (unlanded) {
		lines.push(
			color.yellow(
				`  discarded ${unlanded} commit(s) that were never on ${worktree.base}`,
			),
		);
	}
	if (freed !== null) {
		lines.push(`  slot:     ${freedLine(freed)}`);
	}
	if (deleted !== null) {
		lines.push(deleted);
	}
	for (const each of released) {
		lines.push(
			each === held
				? `  task ${each.id} holds the deferred work, ready and out of the queue until queued by hand: ${each.subject}`
				: `  task ${each.id} is open again, out of the queue until queued by hand: ${each.subject}`,
		);
	}
	if (reason === "blocked") {
		lines.push(
			...ask.blockedBy.map((id) => `  waits on: task ${id} merging`),
			...ask.questions.map(
				(text) => `  waits on: the person answering ${text.split("\n")[0]}`,
			),
			...ask.outside.map((what) => `  waits on: ${what}`),
		);
	}
	log.info(lines.join("\n"));
	return {
		released: released.map(({ id, subject }) => ({ id, subject })),
	};
}
