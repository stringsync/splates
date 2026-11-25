/** What the Evals page reads of the saved launches. */
export interface EvalBatchOwners {
	batchConversations(results: string): Promise<Map<string, string>>;
}

/** The saved launches of a project that launches no evals: no batch has a conversation. */
export class NoopEvalLaunches implements EvalBatchOwners {
	async batchConversations(_results: string): Promise<Map<string, string>> {
		return new Map();
	}
}
