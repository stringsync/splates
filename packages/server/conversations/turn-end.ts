import type { Used } from "../spend";
import type { Adherence, Outcomes } from "../stats";
import type { Storage } from "../storage";
import type { RuleSuggestions, TrustStore } from "../trust";
import type { Conversation } from "./conversation";
import type { ProjectRoster } from "./host";
import type { ConversationsOptions } from "./options";
import { spent } from "./spent";

/** What looks back at a turn once it ends, each null for nothing. */
export interface LookingBack {
	adherence: Adherence | null;
	outcomes: Outcomes | null;
	trust?: TrustStore | null;
	trustFiles?: ConversationsOptions["trustFiles"];
	/** Suggests rules for corrections the user keeps making, once trust records them. */
	rules?: RuleSuggestions | null;
	spend: NonNullable<ConversationsOptions["spend"]> | null;
	storage: Storage;
	root: string | null;
	projects: ProjectRoster;
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
 * skill, an outcome it saved, what it cost.
 */
export function lookBack(
	conversation: Conversation,
	{
		adherence,
		outcomes,
		trust = null,
		trustFiles,
		rules = null,
		spend,
		storage,
		root,
		projects,
	}: LookingBack,
	began: Began,
): void {
	const projectRoot = root ?? conversation.cwd ?? "";
	const now = conversation.now();
	void adherence?.judge(conversation.state, projectRoot, now).catch(() => {});
	const state = conversation.state;
	const task = state.task;
	void trust
		?.observeConversation(state, projectRoot, now)
		.then(async (added) => {
			if (
				task !== null &&
				trustFiles !== undefined &&
				(await trust.hasScopeHistory(projectRoot))
			) {
				const changes = await trustFiles(task).catch(() => null);
				if (changes !== null) {
					await trust
						.rememberTaskFiles({
							...changes,
							project: projectRoot,
							task,
							endedAt: null,
						})
						.catch(() => {});
				}
			}
			return added;
		})
		.then((added) =>
			added === 0 || rules === null
				? undefined
				: rules.suggest(
						projectRoot,
						conversation.state.task ?? conversation.state.lastTask ?? null,
					),
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
	if (began.used !== null && spend !== null) {
		void spent(spend, conversation, {
			before: began.used,
			turnsBefore: began.turnsBefore,
			root,
			projects,
		}).catch(() => {});
	}
}
