import { pushKey, subscribePush, unsubscribePush } from "./api";
import { wantsOf } from "./notifier";
import type { Settings } from "./settings";

/**
 * Subscribes this device to the server's pushes while `settings` say to
 * notify, telling the server which notices they ask for, and unsubscribes it
 * once they say not to. True while subscribed: the server's pushes then show
 * the notifications, so the page shows none itself. False where the browser
 * cannot be pushed to, or subscribing failed, leaving the page to show them.
 */
export async function syncPush(settings: Settings): Promise<boolean> {
	const registration = await navigator.serviceWorker?.getRegistration();
	const manager = registration?.pushManager;
	if (manager === undefined) {
		return false;
	}
	try {
		const held = await manager.getSubscription();
		if (!settings.get("notifications.on")) {
			if (held !== null) {
				await unsubscribePush(held.endpoint);
				await held.unsubscribe();
			}
			return false;
		}
		const key = await pushKey();
		// Made with keys the server no longer holds, as when its file went:
		// nothing it pushes would reach it.
		if (held !== null && keyOf(held) !== key) {
			await held.unsubscribe();
		}
		const subscription =
			held !== null && keyOf(held) === key
				? held
				: await manager.subscribe({
						userVisibleOnly: true,
						applicationServerKey: key,
					});
		await subscribePush(subscription.toJSON(), {
			...wantsOf(settings),
			inFront: settings.get("notifications.inFront"),
		});
		return true;
	} catch {
		return false;
	}
}

/** The server key `subscription` was made with, base64url. */
function keyOf(subscription: PushSubscription): string | null {
	const key = subscription.options.applicationServerKey;
	return key === null
		? null
		: new Uint8Array(key).toBase64({
				alphabet: "base64url",
				omitPadding: true,
			});
}
