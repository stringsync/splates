import type { Wants } from "@stringsync/splates-server/push/browser";
import { ApiError, sendJson } from "./request";

/** The public key this device subscribes to the server's pushes with. */
export async function pushKey(): Promise<string> {
	const response = await fetch("/api/push");
	if (!response.ok) {
		throw new ApiError("error", `/api/push: ${response.status}`);
	}
	return ((await response.json()) as { publicKey: string }).publicKey;
}

/** Has the server push this device the notices `wants` asks for, at `subscription`. */
export async function subscribePush(
	subscription: PushSubscriptionJSON,
	wants: Wants & { inFront: boolean },
): Promise<void> {
	await sendJson("/api/push/subscription", "PUT", { subscription, wants });
}

/** Has the server stop pushing to the subscription `endpoint` names. */
export async function unsubscribePush(endpoint: string): Promise<void> {
	await sendJson("/api/push/subscription", "DELETE", { endpoint });
}
