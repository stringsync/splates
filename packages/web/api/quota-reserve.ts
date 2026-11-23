import type { ReserveHold } from "@splates/server/auto-pick/browser";
import { ApiError, answered, scoped } from "./request";

/** The agent-queued tasks waiting for the quota reserve, by task id. */
export async function readQuotaReserve(): Promise<Record<number, ReserveHold>> {
	const response = await answered(scoped("/api/quota-reserve"));
	if (!response.ok) {
		throw new ApiError("error", `/api/quota-reserve: ${response.status}`);
	}
	return (await response.json()) as Record<number, ReserveHold>;
}
