import { modelValue } from "../models";
import { turnSpend, type Used } from "../spend";
import type { Conversation } from "./conversation";
import type { ProjectRoster } from "./host";
import type { ConversationsOptions } from "./options";
import type { ConversationState } from "./state";

/**
 * Adds the dollars the turn that took `conversation` from `before` cost to
 * `spend`'s ledger, under the project whose main tree is `root`, or the
 * conversation's own tree.
 */
export async function spent(
	spend: NonNullable<ConversationsOptions["spend"]>,
	conversation: Conversation,
	{
		before,
		turnsBefore,
		root,
		projects,
	}: {
		before: Used;
		/** How many turns OpenCode had said it ran before it. */
		turnsBefore: number;
		root: string | null;
		projects: ProjectRoster | null;
	},
): Promise<void> {
	const { state } = conversation;
	const observed = (state.usage.opencode?.turns ?? [])
		.slice(turnsBefore)
		.flatMap((turn) =>
			turn.tokens === null
				? []
				: [
						{
							model: turn.confirmed ?? turn.requested,
							input: turn.tokens.input ?? 0,
							cachedRead: turn.tokens.cachedRead ?? 0,
							cachedWrite: turn.tokens.cachedWrite ?? 0,
							output: turn.tokens.output ?? 0,
						},
					],
		);
	const model = modelValue(state.settings);
	const cost = turnSpend(
		state.agent,
		model,
		before,
		usedOf(state),
		await spend.prices.catalog(),
		observed,
	);
	if (cost === null) {
		return;
	}
	const tree = root ?? conversation.cwd;
	const project =
		(await projects?.list())?.find((each) => each.root === tree)?.slug ?? null;
	await spend.ledger.record({
		at: conversation.now(),
		provider: state.agent,
		service: model ?? "unknown",
		kind: cost.kind,
		dollars: cost.dollars,
		project,
		task: state.task,
		conversation: conversation.id,
	});
}

/** What `state` has used so far, for pricing the turn between two such readings. */
export function usedOf(state: ConversationState): Used {
	const { usage } = state;
	return {
		input: usage.input,
		cached: usage.cached,
		output: usage.output,
		cost: usage.cost?.currency === "USD" ? usage.cost.amount : null,
		context: usage.context?.used ?? null,
	};
}
