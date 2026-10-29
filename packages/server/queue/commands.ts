import { color, type Logger } from "webappwiz/log";
import { age } from "../age";
import {
	elsewhereName,
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
import { QueueMoves } from "./moves";
import { holdsBack, queueOrder, unqueuedBlockers } from "./order";

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
	log.info(
		queued
			.map(
				(task) => `${color.green("queued")} task ${task.id}: ${task.subject}`,
			)
			.join("\n"),
	);
	await sayUnqueuedBlockers(
		{ tasks, log },
		queued.map((task) => task.id),
	);
	return queued;
}

/**
 * Names the tasks just queued, `ids`, wait on that are not queued, however
 * far down, with the command that queues them, blockers first: until then
 * those stay queued and blocked. Says nothing when there are none.
 */
export async function sayUnqueuedBlockers(
	{ tasks, log }: QueueDeps,
	ids: readonly number[],
): Promise<void> {
	const all = (await tasks.all()).map((task) => task.state);
	const chain = unqueuedBlockers(ids, all);
	if (chain.length === 0) {
		return;
	}
	log.info(
		`${color.yellow("blocked")} by ${chain.length === 1 ? "a task" : `${chain.length} tasks`} not queued, so it waits until they are:\n${chain
			.map((task) => `  #${task.id} ${task.subject} (${task.stage})`)
			.join(
				"\n",
			)}\nqueue them too with \`splates queue add ${chain.map((task) => task.id).join(" ")}\``,
	);
}

/**
 * Takes tasks `ids` out of the queue, back to `ready` when they were
 * groomed, else `backlog`. Refuses one not in it.
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
 * Moves queued task `id` to `position` in the queue, from 1 for the next to
 * start, past the end meaning the end. What it is blocked by still goes
 * first, so it lands as near there as its links allow; prints the queue.
 */
export async function queueMove(
	deps: QueueDeps,
	id: number,
	position: number,
): Promise<void> {
	await new QueueMoves(deps.tasks).move(id, position);
	await queueList(deps);
}

/** What `task` waits on among `all`, as the queue lists it. */
function waitsOn(task: TaskRecord, all: readonly TaskRecord[]): string {
	const { open, lost, elsewhere } = holdsBack(task, all);
	return [
		...open.map(
			(other) =>
				`#${other.id}${other.takenBy !== null ? " (under way)" : other.stage === "queued" ? "" : ` (${other.stage})`}`,
		),
		...lost.map((gone) => `#${gone} (removed)`),
		...elsewhere.map(
			(blocker) =>
				`${elsewhereName(blocker)}${blocker.lost ? " (removed)" : " (another project)"}`,
		),
	].join(", ");
}

/**
 * Call it first in a command that changes the queue: it refuses an agent,
 * since only the person queues, unqueues or orders work, telling the agent
 * to end its reply with a queue card instead.
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
