import type { ThreadMessageLike } from "@assistant-ui/react";
import type { PermissionProposal } from "@splates/server/plans";

type LikePart = Exclude<ThreadMessageLike["content"], string>[number];

/** What a queue card's part carries once a later card for the same lane supplants it. */
export interface PermissionData {
	permission: PermissionProposal;
	/** A later queue card names the same lane, so this one folds to an event line. */
	superseded?: boolean;
}

/**
 * `thread` with each queue card marked `superseded` when a later queue card,
 * in this message or a following one, names the same lane.
 */
export function supersedeQueues(
	thread: ThreadMessageLike[],
): ThreadMessageLike[] {
	const later: PermissionProposal[] = [];
	const out = thread.slice();
	for (let at = thread.length - 1; at >= 0; at--) {
		const message = thread[at] as ThreadMessageLike;
		if (message.role !== "assistant" || typeof message.content === "string") {
			continue;
		}
		const seen: PermissionProposal[] = [];
		let changed = false;
		const content = message.content
			.map((part) => part)
			.reverse()
			.map((part) => {
				const permission = queueOf(part);
				if (permission === null) {
					return part;
				}
				const folded = later.some((each) => supplants(permission, each));
				seen.push(permission);
				if (!folded) {
					return part;
				}
				changed = true;
				const { data } = part as { data: PermissionData };
				return {
					...part,
					data: { ...data, superseded: true },
				} as LikePart;
			})
			.reverse();
		later.push(...seen);
		if (changed) {
			out[at] = { ...message, content } as ThreadMessageLike;
		}
	}
	return out;
}

function queueOf(part: LikePart): PermissionProposal | null {
	if (part.type !== "data-permission") {
		return null;
	}
	const { permission } = part.data as PermissionData;
	return permission.action === "queue" ? permission : null;
}

/** Whether queue card `later` asks to queue the lane `earlier` does, in the same project. Task cards never supplant: an agent may spawn several one-off tasks. */
function supplants(
	earlier: PermissionProposal,
	later: PermissionProposal,
): boolean {
	return (
		earlier.lane !== null &&
		earlier.lane === later.lane &&
		earlier.project === later.project
	);
}
