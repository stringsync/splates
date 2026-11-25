import { color, type Logger } from "core/log";
import type { Fs } from "core/system";
import { age } from "../age";
import {
	elsewhereName,
	enqueued,
	type QueuedBy,
	type Task,
	type TaskRecord,
	type Tasks,
	unqueued,
} from "../board";
import { fail } from "../exit";
import { pickLabel } from "../models";
import type { Projects } from "../projects";
import { table } from "../table";
import type { WorktreeService } from "../tasks";
import { type ServerSend, serverOf } from "../workers";
import {
	type AgentQueueAuthorizeResult,
	type ChainBudgetReading,
	tokensSaid,
} from "./agent-settings";
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
 * Puts tasks `ids` in the queue, for a worker
 * to start once nothing they are blocked by is open. Refuses one an agent
 * has taken, which is already under way.
 */
export async function queueAdd(
	{ tasks, log }: QueueDeps,
	ids: number[],
	{ by = { by: "person" } }: { by?: QueuedBy } = {},
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
		queued.push(await tasks.revise(task.id, (state) => enqueued(state, by)));
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
 * Takes tasks `ids` out of the queue, available again. Refuses one not
 * in it.
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

/** Options `refuseAgentQueue` uses to ask the server about an agent's `queue add`. */
export interface AgentQueueCheckOptions {
	ids?: readonly number[];
	projects?: Pick<Projects, "list">;
	log?: Logger;
	fs?: Fs;
	send?: ServerSend;
}

/**
 * Call it first in a command that changes the queue: it lets a person through,
 * refuses every agent queue command other than `queue add` and `lane queue`,
 * and for those asks `splates server` whether this project's setting and
 * per-conversation cap allow the agent to queue `ids` (a lane's waiting tasks
 * for `lane queue`, all or none), returning who queued them.
 */
export async function refuseAgentQueue(
	service: Pick<WorktreeService, "ps"> & Partial<Pick<WorktreeService, "git">>,
	command: string,
	opts: AgentQueueCheckOptions = {},
): Promise<QueuedBy> {
	const asking =
		service.ps.env("SPLATES_CONVERSATION") ??
		service.ps.env("SPLATES_STARTED_BY");
	if (asking === undefined) {
		return { by: "person" };
	}
	if (command !== "queue add" && command !== "lane queue") {
		fail(
			"usage",
			`an agent does not change the queue, so it runs no \`splates ${command}\`: \`splates task add\` the work and end your reply with a queue card for the person to queue it`,
			{ command, caller: asking },
		);
	}
	const ids = opts.ids ?? [];
	const server =
		opts.log === undefined
			? null
			: await serverOf({
					ps: service.ps,
					fs: opts.fs,
					log: opts.log,
					send: opts.send,
				});
	if (server === null || ids.length === 0) {
		fail(
			"usage",
			`an agent does not change the queue, so it runs no \`splates ${command}\`: \`splates task add\` the work and end your reply with a queue card for the person to queue it`,
			{ command, caller: asking },
		);
	}
	const slug =
		service.git === undefined || opts.projects === undefined
			? undefined
			: (await opts.projects.list()).find(
					(each) => each.root === service.git?.root,
				)?.slug;
	const path =
		slug === undefined
			? "/api/queue/agent-authorize"
			: `/api/queue/agent-authorize?${new URLSearchParams({ project: slug })}`;
	let response: Response;
	try {
		response = await server.send(new URL(path, server.url).toString(), {
			method: "POST",
			headers: {
				origin: server.url,
				"content-type": "application/json",
			},
			body: JSON.stringify({ conversation: asking, ids }),
		});
	} catch {
		fail(
			"usage",
			`splates server could not be reached to check whether an agent may queue tasks: end your reply with a queue card for the person to queue it`,
			{ command, caller: asking },
		);
	}
	if (!response.ok) {
		const raw = (await response.json().catch(() => ({}))) as {
			reason?: string;
			message?: string;
		};
		fail(
			raw.reason === "exists"
				? "exists"
				: raw.reason === "not_found"
					? "not_found"
					: "usage",
			raw.message ??
				`splates server refused agent \`splates ${command}\`: end your reply with a queue card for the person to queue it`,
			{ command, caller: asking },
		);
	}
	const decision = (await response.json()) as AgentQueueAuthorizeResult;
	if (!decision.allowed) {
		if (decision.reason === "cap") {
			fail(
				"usage",
				`this conversation has already queued ${decision.queued} of its ${decision.cap} tasks: end your reply with a queue card for the person to queue the rest`,
				{
					command,
					caller: asking,
					queued: decision.queued,
					cap: decision.cap,
				},
			);
		}
		if (decision.reason === "budget" || decision.reason === "stopped") {
			const { chain } = decision;
			fail(
				"usage",
				decision.reason === "stopped"
					? `auto-queue was stopped for the ${chain.name} chain: end your reply with a queue card for the person to queue it`
					: `the ${chain.name} chain spent ${tokensSaid(chain.spent)} of its ${tokensSaid(chain.budget)} token budget, so it queues nothing and asks before starting work: ask the person this numbered question, with your own words for what you want to queue and its cost, then apply their answer with \`splates queue budget --add 2M\`, \`--add 5M\`, \`--add <tokens>\` or \`--stop\`, and end your reply with a queue card until they answer:\n\n1. How much more may the ${chain.name} chain spend?\n   It spent ${tokensSaid(chain.spent)} of ${tokensSaid(chain.budget)}; #<id> wants to queue #<id> <subject> (about <n>M).\n   - (a) Add 2M\n   - (b) Add 5M\n   - (c) Add a custom amount\n   - (d) Stop auto for this chain`,
				{
					command,
					caller: asking,
					spent: chain.spent,
					budget: chain.budget,
				},
			);
		}
		fail(
			"usage",
			`this project does not allow agents to queue tasks on their own: end your reply with a queue card for the person to queue it`,
			{ command, caller: asking, level: decision.level },
		);
	}
	return decision.by;
}

/**
 * Applies the person's answer to the out-of-budget question for the chain of
 * the asking agent: adds `add` tokens to its budget, or stops auto for it.
 * Prints what the chain may now spend.
 */
export async function changeChainBudget(
	service: Pick<WorktreeService, "ps"> & Partial<Pick<WorktreeService, "git">>,
	change: { add?: number; stop?: boolean },
	opts: AgentQueueCheckOptions,
): Promise<void> {
	const asking =
		service.ps.env("SPLATES_CONVERSATION") ??
		service.ps.env("SPLATES_STARTED_BY");
	if (asking === undefined) {
		fail(
			"usage",
			"only an agent has a chain: the person sets the budget in Settings, under Agents",
		);
	}
	const server =
		opts.log === undefined
			? null
			: await serverOf({
					ps: service.ps,
					fs: opts.fs,
					log: opts.log,
					send: opts.send,
				});
	if (server === null) {
		fail("usage", "splates server could not be reached to change the budget");
	}
	const slug =
		service.git === undefined || opts.projects === undefined
			? undefined
			: (await opts.projects.list()).find(
					(each) => each.root === service.git?.root,
				)?.slug;
	const path =
		slug === undefined
			? "/api/queue/agent-budget"
			: `/api/queue/agent-budget?${new URLSearchParams({ project: slug })}`;
	const response = await server.send(new URL(path, server.url).toString(), {
		method: "POST",
		headers: { origin: server.url, "content-type": "application/json" },
		body: JSON.stringify({ conversation: asking, ...change }),
	});
	if (!response.ok) {
		fail("usage", "splates server refused the budget change");
	}
	const chain = (await response.json()) as ChainBudgetReading;
	opts.log?.info(
		chain.stopped
			? `auto-queue is stopped for the ${chain.name} chain`
			: `the ${chain.name} chain has spent ${tokensSaid(chain.spent)} of ${tokensSaid(chain.budget)}`,
	);
}

/** Parses `2M`, `500k` or `2500000` as a count of tokens. */
export function parseTokens(text: string): number {
	const match = /^(\d+(?:\.\d+)?)\s*([kKmM]?)$/.exec(text.trim());
	if (match === null) {
		fail(
			"usage",
			`${text} is not an amount of tokens: say 2M, 500k or 2500000`,
		);
	}
	const unit = (match[2] ?? "").toLowerCase();
	const scale = unit === "m" ? 1_000_000 : unit === "k" ? 1_000 : 1;
	return Math.round(Number(match[1]) * scale);
}
