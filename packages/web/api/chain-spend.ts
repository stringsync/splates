import type { ChainBudgetReading } from "@splates/server/queue/browser";
import { ApiError, answered, scoped } from "./request";

/** What each agent-queued task chain has spent, by its root conversation. */
export async function readChainSpends(): Promise<
	Record<string, ChainBudgetReading>
> {
	const response = await answered(scoped("/api/queue/chain-spend"));
	if (!response.ok) {
		throw new ApiError("error", `/api/queue/chain-spend: ${response.status}`);
	}
	return (await response.json()) as Record<string, ChainBudgetReading>;
}
