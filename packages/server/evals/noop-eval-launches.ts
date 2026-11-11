import type { EvalBudgetStatus } from "./budget";
import type { EvalStore } from "./store";

/** What the Evals page reads of the saved launches. */
export interface EvalBatchOwners {
	batchConversations(results: string): Promise<Map<string, string>>;
	budgets: {
		statusOf(conversation: string, store: EvalStore): Promise<EvalBudgetStatus>;
	};
}

/** The saved launches of a project that launches no evals: no batch has a conversation. */
export class NoopEvalLaunches implements EvalBatchOwners {
	readonly budgets = {
		statusOf: async (
			_conversation: string,
			_store: EvalStore,
		): Promise<EvalBudgetStatus> => {
			throw new Error("no eval launches, so no conversation has a budget");
		},
	};

	async batchConversations(_results: string): Promise<Map<string, string>> {
		return new Map();
	}
}
