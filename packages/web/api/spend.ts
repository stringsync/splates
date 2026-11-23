import type {
	BillingView,
	PlanProvider,
	SpendReport,
	UnusedQuotaReport,
} from "@splates/server/spend";
import { Duration } from "core/time";
import { type Answering, ApiError, answered } from "./request";

/** The dollars spent from `since` to `until` (ISO timestamps), across every project on this machine. */
export async function spend(
	since: string,
	until: string,
): Promise<SpendReport> {
	const query = new URLSearchParams({ since, until });
	const response = await answered(`/api/spend?${query}`);
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

async function billingCall(
	path: string,
	init?: Answering,
): Promise<BillingView> {
	const response = await answered(path, init);
	const body = (await response.json().catch(() => ({}))) as BillingView & {
		message?: string;
	};
	if (!response.ok) {
		throw new ApiError("error", body.message ?? `${path}: ${response.status}`);
	}
	return body;
}

/** The display currency and how each provider's last pull went. */
export const billing = (): Promise<BillingView> => billingCall("/api/billing");

/** Pulls what each provider billed, answering as `billing` does. */
export const pullBilling = (): Promise<BillingView> =>
	billingCall("/api/billing/pull", {
		method: "POST",
		// Each provider is asked in turn, any of them slow to answer.
		within: Duration.mins(2),
	});

/** Saves a monthly plan fee and renewal day for an agent provider. */
export const setPlan = (
	provider: PlanProvider,
	amount: number,
	renewalDay: number,
): Promise<BillingView> =>
	billingCall("/api/billing/plan", {
		method: "PUT",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ provider, amount, renewalDay }),
	});

/** Removes a saved manual plan override for an agent provider. */
export const clearPlan = (provider: PlanProvider): Promise<BillingView> =>
	billingCall(`/api/billing/plan?provider=${encodeURIComponent(provider)}`, {
		method: "DELETE",
	});

/** Ranked unused subscription quota over `days` (28 for 4 weeks, 90 for 90 days). */
export async function unusedQuota(days: 28 | 90): Promise<UnusedQuotaReport> {
	const query = new URLSearchParams({ days: String(days) });
	const response = await answered(`/api/billing/unused-quota?${query}`);
	const body = (await response
		.json()
		.catch(() => ({}))) as UnusedQuotaReport & {
		message?: string;
	};
	if (!response.ok) {
		throw new ApiError(
			"error",
			body.message ?? `/api/billing/unused-quota: ${response.status}`,
		);
	}
	return body;
}
