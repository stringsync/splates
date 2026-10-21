import type { Used } from "../spend";
import type { Adherence, Outcomes } from "../stats";
import type { Storage } from "../storage";
import type { Conversation } from "./conversation";
import type { ProjectRoster, Weigh } from "./host";
import type { ConversationsOptions } from "./options";
import { spent } from "./spent";

/** What looks back at a turn once it ends, each null for nothing. */
export interface LookingBack {
	adherence: Adherence | null;
	outcomes: Outcomes | null;
	weigh: Weigh | null;
	spend: NonNullable<ConversationsOptions["spend"]> | null;
	storage: Storage;
	root: string | null;
	projects: ProjectRoster | null;
}

/** A turn as it began, as far as this server saw it begin. */
export interface Began {
	/** When; null when it began before this server. */
	at: string | null;
	/** What it had used by then, for the ledger; null when unseen. */
	used: Used | null;
	/** How many turns OpenCode had said it ran by then. */
	turnsBefore: number;
}

/**
 * Looks back, without waiting, at the turn of `conversation` that began as
 * `began` says and has just ended, however it did: how it followed the
 * skill, an outcome it saved, the notes it applied and what it cost.
 */
export function lookBack(
	conversation: Conversation,
	{ adherence, outcomes, weigh, spend, storage, root, projects }: LookingBack,
	began: Began,
): void {
	void adherence
		?.judge(
			conversation.state,
			root ?? conversation.cwd ?? "",
			conversation.now(),
		)
		.catch(() => {});
	// A task it merged wrote its outcome before the turn said its usage.
	if (outcomes !== null && began.at !== null) {
		void outcomes
			.creditSaved(
				conversation,
				storage.log(`${conversation.id}.jsonl`),
				began.at,
				conversation.now(),
			)
			.catch(() => {});
	}
	if (weigh !== null && began.at !== null) {
		void weigh(conversation, began.at).catch(() => {});
	}
	if (began.used !== null && spend !== null) {
		void spent(spend, conversation, {
			before: began.used,
			turnsBefore: began.turnsBefore,
			root,
			projects,
		}).catch(() => {});
	}
}
