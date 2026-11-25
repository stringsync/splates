import type { ChainView } from "@splates/server/queue/browser";
import { ApiError, answered, scoped } from "./request";

/** The task chain `conversation` belongs to, or null when no agent-queued task hangs from it. */
export async function readAgentChain(
	conversation: string,
): Promise<ChainView | null> {
	const response = await answered(
		scoped(`/api/queue/agent-chain?${new URLSearchParams({ conversation })}`),
	);
	if (!response.ok) {
		throw new ApiError("error", `/api/queue/agent-chain: ${response.status}`);
	}
	const chain = (await response.json()) as ChainView | null;
	return chain !== null && Array.isArray(chain.nodes) ? chain : null;
}
