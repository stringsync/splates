import type {
	BillingView,
	RunnersReport,
	SpendReport,
} from "@stringsync/splates-server/spend";
import { Duration } from "webappwiz/time";
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

/** Every runner ever made, what each cost, and their days and months beside the bill, across every project on this machine. */
export async function runners(): Promise<RunnersReport> {
	const response = await answered("/api/billing/runners");
	const body = (await response.json().catch(() => ({}))) as RunnersReport & {
		message?: string;
	};
	if (!response.ok) {
		throw new ApiError(
			"error",
			body.message ?? `/api/billing/runners: ${response.status}`,
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

/** Sets the currency the Billing page shows amounts in. */
export const setCurrency = (currency: string): Promise<BillingView> =>
	billingCall("/api/billing/currency", {
		method: "PUT",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ currency }),
	});
