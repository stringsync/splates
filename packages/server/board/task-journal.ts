import { basename } from "node:path";
import type { AgentPick } from "../models";
import type { Facts, Journal } from "../records";
import type { Task, TaskRecord } from "./task";
import type { Tasks } from "./tasks";

/**
 * Runs `update`, which changes task `id`, and journals what it moved; a
 * refused one is journaled with nothing moved.
 */
export async function recordUpdate(
	journal: Journal,
	tasks: Tasks,
	id: number,
	update: () => Promise<Task>,
): Promise<Task> {
	let before: TaskRecord | undefined;
	return journal.record(
		"task update",
		null,
		async () => {
			before = (await tasks.find(id)).state;
			return update();
		},
		(after) => updated(before ?? after.state, after.state),
	);
}

/** What moved between `before` and `after`, of one task. */
function updated(before: TaskRecord, after: TaskRecord): Facts["task update"] {
	const named = (paths: string[]) => paths.map((path) => basename(path));
	const attached = after.files.filter((path) => !before.files.includes(path));
	const detached = before.files.filter((path) => !after.files.includes(path));
	const blocked = after.blockedBy.filter(
		(id) => !before.blockedBy.includes(id),
	);
	const unblocked = before.blockedBy.filter(
		(id) => !after.blockedBy.includes(id),
	);
	const same = (old?: AgentPick, now?: AgentPick) =>
		old?.agent === now?.agent &&
		old?.model === now?.model &&
		old?.effort === now?.effort;
	const changed: Facts["task update"]["changed"] = {
		...(after.subject === before.subject ? {} : { subject: after.subject }),
		...(after.slug === before.slug ? {} : { slug: after.slug }),
		...(after.text === before.text ? {} : { text: true as const }),
		...(after.position === before.position ? {} : { position: after.position }),
		...(after.lane === before.lane ? {} : { lane: after.lane }),
		...(blocked.length === 0 ? {} : { blocked }),
		...(unblocked.length === 0 ? {} : { unblocked }),
		...(attached.length === 0 ? {} : { attached: named(attached) }),
		...(detached.length === 0 ? {} : { detached: named(detached) }),
		...(same(before.assignee, after.assignee)
			? {}
			: { assignee: after.assignee ?? null }),
		...(after.groomed && !before.groomed ? { ready: true as const } : {}),
		...(Boolean(after.manual) === Boolean(before.manual)
			? {}
			: { manual: after.manual === true }),
	};
	return { number: after.id, subject: after.subject, changed };
}
