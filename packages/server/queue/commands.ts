import { color, type Logger } from "webappwiz/log";
import { age } from "../age";
import {
	enqueued,
	type Task,
	type TaskRecord,
	type Tasks,
	unqueued,
} from "../board";
import { fail } from "../exit";
import { pickLabel } from "../models";
import { table } from "../table";
import type { WorktreeService } from "../tasks";
import { holdsBack, queueOrder } from "./order";

/** What the queue commands work with. */
export interface QueueDeps {
	tasks: Tasks;
	log: Logger;
}

/**
 * The queue in the order workers take it, each task with what it waits on:
 * the open tasks it is blocked by, or those removed without merging.
 */
export async function queueList(
	{ tasks, log }: QueueDeps,
	{ json = false }: { json?: boolean } = {},
): Promise<void> {
	const all = (await tasks.all()).map((task) => task.state);
	const order = queueOrder(all);
	if (json) {
		log.info(JSON.stringify(order, null, "\t"));
		return;
	}
	if (order.length === 0) {
		log.info(
			"the queue is empty: `splates queue add <n>` queues a task for a worker to start",
		);
		return;
	}
	log.info(
		table(
			["POS", "ID", "SUBJECT", "MODEL", "WAITS ON", "AGE"],
			order.map((task, at) => [
				String(at + 1),
				String(task.id),
				task.subject,
				task.assignee === undefined ? "" : pickLabel(task.assignee),
				waitsOn(task, all),
				age(task.createdAt),
			]),
		),
	);
}

/**
 * Puts tasks `ids` in the queue, from the backlog or groomed, for a worker
 * to start once nothing they are blocked by is open. Refuses one an agent
 * has taken, which is already under way.
 */
export async function queueAdd(
	{ tasks, log }: QueueDeps,
	ids: number[],
): Promise<Task[]> {
	const found = await Promise.all(ids.map((id) => tasks.find(id)));
	const taken = found.find((task) => task.takenBy !== null);
	if (taken !== undefined) {
		fail(
			"exists",
			`task ${taken.id} is under way as '${taken.takenBy}', so it is past the queue: nothing was queued`,
			{ number: taken.id, takenBy: taken.takenBy },
		);
	}
	const queued: Task[] = [];
	for (const task of found) {
		queued.push(
			await tasks.revise(task.id, (state) => enqueued(state, { by: "person" })),
		);
	}
	// Queued again by hand, a queued lane counts it in once more.
	await tasks.skipInLanes(ids, false);
	log.info(
		queued
			.map(
				(task) => `${color.green("queued")} task ${task.id}: ${task.subject}`,
			)
			.join("\n"),
	);
	return queued;
}

/**
 * Takes tasks `ids` out of the queue, back to `ready` when they were
 * groomed, else `backlog`, and out of their lane's when it is queued whole,
 * until they are queued again. Refuses one not in it.
 */
export async function queueRemove(
	{ tasks, log }: QueueDeps,
	ids: number[],
): Promise<Task[]> {
	const found = await Promise.all(ids.map((id) => tasks.find(id)));
	const out = found.find((task) => task.state.stage !== "queued");
	if (out !== undefined) {
		fail(
			"not_found",
			`task ${out.id} is not in the queue: nothing was taken out`,
			{
				number: out.id,
			},
		);
	}
	const removed: Task[] = [];
	for (const task of found) {
		removed.push(await tasks.revise(task.id, unqueued));
	}
	// So a queued lane does not queue it straight back.
	await tasks.skipInLanes(ids, true);
	log.info(
		removed
			.map(
				(task) =>
					`${color.green("unqueued")} task ${task.id}: ${task.subject}, now ${task.state.stage}`,
			)
			.join("\n"),
	);
	return removed;
}

/**
 * Takes each task in `going` out of the queue, as `stalled` finds them,
 * noting the blockers it was let go for; passes over one taken or
 * unqueued meanwhile. A queued lane queues it again once nothing blocks it.
 */
export async function letGo(
	tasks: Tasks,
	going: ReadonlyMap<number, readonly number[]>,
): Promise<Task[]> {
	const gone: Task[] = [];
	for (const [id, blockers] of going) {
		let went = false;
		const task = await tasks.revise(id, (state) => {
			went = state.stage === "queued" && state.takenBy === null;
			return went ? { ...unqueued(state), unqueuedFor: [...blockers] } : state;
		});
		if (went) {
			gone.push(task);
		}
	}
	return gone;
}

/**
 * Moves queued task `id` to `position` in the queue, from 1 for the next to
 * start, past the end meaning the end. What it is blocked by still goes
 * first, so it lands as near there as its links allow; prints the queue.
 */
export async function queueMove(
	deps: QueueDeps,
	id: number,
	position: number,
): Promise<void> {
	await moveInQueue(deps.tasks, id, position);
	await queueList(deps);
}

/**
 * Moves queued task `id` to `position` in the queue, from 1, as
 * `queueMove` does, saying nothing.
 */
export async function moveInQueue(
	tasks: Tasks,
	id: number,
	position: number,
): Promise<void> {
	if (!Number.isInteger(position) || position <= 0) {
		fail("usage", `'${position}' is not a position: 1 is the next to start`, {
			number: id,
			position,
		});
	}
	const all = (await tasks.all()).map((task) => task.state);
	const task = all.find((each) => each.id === id);
	if (task?.stage !== "queued" || task.takenBy !== null) {
		fail("not_found", `task ${id} is not waiting in the queue`, { number: id });
	}
	const order = queueOrder(all).filter((each) => each.id !== id);
	const at = order[position - 1];
	const last = order.at(-1);
	const target = at === undefined ? (last?.position ?? 0) + 1 : at.position;
	// Moving down, the task leaves its place first, so every one between
	// moves up one: what was at `target` is then one higher.
	await tasks.move(id, task.position < target ? target - 1 : target);
}

/** What `task` waits on among `all`, as the queue lists it. */
function waitsOn(task: TaskRecord, all: readonly TaskRecord[]): string {
	const { open, lost } = holdsBack(task, all);
	return [
		...open.map(
			(other) =>
				`#${other.id}${other.takenBy !== null ? " (under way)" : other.stage === "queued" ? "" : ` (${other.stage})`}`,
		),
		...lost.map((gone) => `#${gone} (removed)`),
	].join(", ");
}

/**
 * Refuses a command that changes the queue when an agent runs it: only the
 * person queues, unqueues or orders work, as `splates add --agent` is
 * refused, and an agent asks them to through the queue card its reply ends
 * with. The server starts its tasks with neither variable set.
 */
export function refuseAgentQueue(
	service: Pick<WorktreeService, "ps">,
	command: string,
): void {
	const asking =
		service.ps.env("SPLATES_CONVERSATION") ??
		service.ps.env("SPLATES_STARTED_BY");
	if (asking === undefined) {
		return;
	}
	fail(
		"usage",
		`an agent does not change the queue, so it runs no \`splates ${command}\`: \`splates task add\` the work and end your reply with a queue card for the person to queue it`,
		{ command, caller: asking },
	);
}
