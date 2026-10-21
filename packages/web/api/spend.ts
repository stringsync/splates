import type { SpendReport } from "@stringsync/splates-server/spend";
import { ApiError } from "./request";

/** The dollars spent from `since` to `until` (ISO timestamps), across every project on this machine. */
export async function spend(
	since: string,
	until: string,
): Promise<SpendReport> {
	const query = new URLSearchParams({ since, until });
	const response = await fetch(`/api/spend?${query}`);
	const body = (await response.json().catch(() => ({}))) as SpendReport & {
		message?: string;
	};
	if (!response.ok) {
		throw new ApiError(
			"error",
			body.message ?? `/api/spend: ${response.status}`,
		);
	}
	return body;
}
