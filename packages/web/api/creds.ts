import type { KeptCred, Scope } from "@stringsync/splates-server/creds";
import { ApiError, scoped, send, sendJson } from "./request";

/** What the project's store and the device's keep, by name, and what each store is called. */
export interface KeptCreds {
	kept: KeptCred[];
	labels: Record<Scope, string>;
}

/** The creds kept for this project and this device; never a value. */
export async function keptCreds(): Promise<KeptCreds> {
	const response = await fetch(scoped("/api/creds"));
	const body = (await response.json().catch(() => ({}))) as KeptCreds & {
		reason?: string;
		message?: string;
	};
	if (!response.ok) {
		throw new ApiError(
			body.reason ?? "error",
			body.message ?? `/api/creds: ${response.status}`,
		);
	}
	return body;
}

/**
 * Keeps `value` as `name`: in the scope its open request asked for, else in
 * `scope`. The value goes to the store and never comes back.
 */
export async function saveCred(
	name: string,
	value: string,
	scope?: Scope,
): Promise<void> {
	await sendJson(`/api/creds/${encodeURIComponent(name)}`, "PUT", {
		value,
		scope,
	});
}

export async function removeCred(name: string, scope: Scope): Promise<void> {
	await send(
		`/api/creds/${encodeURIComponent(name)}?${new URLSearchParams({ scope })}`,
		{ method: "DELETE" },
	);
}

/** Turns down the open request for `name`, so the agent waiting on it stops. */
export async function dismissCred(name: string): Promise<void> {
	await send(`/api/creds/${encodeURIComponent(name)}/dismiss`, {});
}
